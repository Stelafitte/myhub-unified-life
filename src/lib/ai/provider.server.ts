// Server-only: routes a chat completion to the user's chosen AI provider
// (Lovable / OpenAI / Anthropic / Google), with safe fallback to Lovable AI.
//
// Existing AI server functions can adopt this helper progressively. Until then
// they keep calling Lovable AI directly. The helper is the single point of
// truth for provider routing and usage logging.
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptAiKey } from "./crypto.server";

export type AiProvider = "lovable" | "openai" | "anthropic" | "google";

export type AiSettings = {
  provider: AiProvider;
  model: string;
  use_own_key: boolean;
  encrypted_api_key: string | null;
  trash_threshold: number;
  feat_trash: boolean;
  feat_classify: boolean;
  feat_summary: boolean;
  feat_suggestions: boolean;
  feat_voice: boolean;
  feat_assistant: boolean;
};

const DEFAULTS: AiSettings = {
  provider: "lovable",
  model: "google/gemini-3-flash-preview",
  use_own_key: false,
  encrypted_api_key: null,
  trash_threshold: 70,
  feat_trash: true,
  feat_classify: true,
  feat_summary: true,
  feat_suggestions: true,
  feat_voice: true,
  feat_assistant: true,
};

/**
 * Loads the user's AI settings from `user_ai_settings`. Falls back to safe
 * defaults (Lovable AI, gemini-3-flash) if no row exists.
 */
export async function getUserAiSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<AiSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("user_ai_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULTS;
  return { ...DEFAULTS, ...data } as AiSettings;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CallAiOptions = {
  userId: string;
  supabase: SupabaseClient; // admin or auth — admin recommended for log writes
  function: string; // e.g. "trash-suggest", "email-classify"
  system?: string;
  prompt: string;
  json?: boolean;
  /** Override the user-configured model (e.g. force a vision/embedding model). */
  modelOverride?: string;
};

export type CallAiResult =
  | { ok: true; text: string; provider: AiProvider; model: string; usedOwnKey: boolean }
  | { ok: false; status: number; error: string };

function pickDefaultModel(provider: AiProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-haiku-latest";
    case "google":
      return "gemini-2.0-flash";
    default:
      return "google/gemini-3-flash-preview";
  }
}

/**
 * Calls the chosen AI provider with a single user prompt + optional system.
 * Falls back to Lovable AI when the user picked a custom provider but didn't
 * supply a valid key, or when encryption is not yet configured.
 */
export async function callAiChat(opts: CallAiOptions): Promise<CallAiResult> {
  const settings = await getUserAiSettings(opts.supabase, opts.userId);
  const startedAt = Date.now();

  let provider: AiProvider = settings.provider;
  let model = opts.modelOverride ?? settings.model ?? pickDefaultModel(provider);
  let usedOwnKey = false;
  let userKey: string | null = null;

  // Try to decrypt user-supplied key
  if (settings.use_own_key && settings.encrypted_api_key && provider !== "lovable") {
    try {
      userKey = decryptAiKey(settings.encrypted_api_key);
      usedOwnKey = true;
    } catch (e) {
      // Encryption misconfigured → fall back silently to Lovable
      provider = "lovable";
      model = pickDefaultModel("lovable");
    }
  } else if (provider !== "lovable") {
    // User picked a provider but didn't enable own-key → fall back
    provider = "lovable";
    model = pickDefaultModel("lovable");
  }

  let result: CallAiResult;
  try {
    if (provider === "lovable") {
      result = await callLovable(model, opts.system, opts.prompt, opts.json);
    } else if (provider === "openai" && userKey) {
      result = await callOpenAi(model, userKey, opts.system, opts.prompt, opts.json);
    } else if (provider === "anthropic" && userKey) {
      result = await callAnthropic(model, userKey, opts.system, opts.prompt, opts.json);
    } else if (provider === "google" && userKey) {
      result = await callGoogle(model, userKey, opts.system, opts.prompt, opts.json);
    } else {
      result = await callLovable(model, opts.system, opts.prompt, opts.json);
    }
    if (result.ok) {
      result.provider = provider;
      result.model = model;
      result.usedOwnKey = usedOwnKey;
    }
  } catch (e) {
    result = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }

  // Fire-and-forget log
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (opts.supabase as any).from("ai_call_log").insert({
      user_id: opts.userId,
      function: opts.function,
      provider,
      model,
      used_own_key: usedOwnKey,
      status: result.ok ? 200 : result.status,
      error: result.ok ? null : result.error.slice(0, 500),
      duration_ms: Date.now() - startedAt,
    });
  } catch {
    /* ignore log errors */
  }

  return result;
}

// ---------- Provider implementations ----------

async function callLovable(
  model: string,
  system: string | undefined,
  prompt: string,
  json?: boolean,
): Promise<CallAiResult> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { ok: false, status: 500, error: "LOVABLE_API_KEY manquant" };
  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: await resp.text().then((t) => t.slice(0, 300)) };
  }
  const data = await resp.json();
  return {
    ok: true,
    text: data?.choices?.[0]?.message?.content ?? "",
    provider: "lovable",
    model,
    usedOwnKey: false,
  };
}

async function callOpenAi(
  model: string,
  apiKey: string,
  system: string | undefined,
  prompt: string,
  json?: boolean,
): Promise<CallAiResult> {
  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: await resp.text().then((t) => t.slice(0, 300)) };
  }
  const data = await resp.json();
  return {
    ok: true,
    text: data?.choices?.[0]?.message?.content ?? "",
    provider: "openai",
    model,
    usedOwnKey: true,
  };
}

async function callAnthropic(
  model: string,
  apiKey: string,
  system: string | undefined,
  prompt: string,
  json?: boolean,
): Promise<CallAiResult> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system ?? undefined,
      messages: [
        {
          role: "user",
          content: json
            ? `${prompt}\n\nRéponds UNIQUEMENT en JSON valide, sans texte autour.`
            : prompt,
        },
      ],
    }),
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: await resp.text().then((t) => t.slice(0, 300)) };
  }
  const data = await resp.json();
  const text = (data?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("");
  return { ok: true, text, provider: "anthropic", model, usedOwnKey: true };
}

async function callGoogle(
  model: string,
  apiKey: string,
  system: string | undefined,
  prompt: string,
  json?: boolean,
): Promise<CallAiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: json ? { responseMimeType: "application/json" } : undefined,
    }),
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, error: await resp.text().then((t) => t.slice(0, 300)) };
  }
  const data = await resp.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  return { ok: true, text, provider: "google", model, usedOwnKey: true };
}

/** Light validation that the user's key actually authenticates with the provider. */
export async function validateProviderKey(
  provider: AiProvider,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) return { ok: true };
      return { ok: false, error: `OpenAI ${r.status}` };
    }
    if (provider === "anthropic") {
      // Anthropic has no GET endpoint without auth-test; do a tiny messages call
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 4,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (r.ok) return { ok: true };
      return { ok: false, error: `Anthropic ${r.status}` };
    }
    if (provider === "google") {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      );
      if (r.ok) return { ok: true };
      return { ok: false, error: `Google ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
