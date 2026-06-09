// Server functions to manage the user's AI provider preferences and personal
// API key. The encrypted key is NEVER returned to the client; only metadata
// (last 4 chars, validation timestamp) is exposed.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Provider = z.enum(["lovable", "openai", "anthropic", "google"]);

// Models offered per provider (extendable later)
export const MODELS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
  lovable: [
    { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (par défaut, rapide)" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (qualité supérieure)" },
    { value: "openai/gpt-5-mini", label: "GPT-5 mini" },
    { value: "openai/gpt-5", label: "GPT-5 (plus coûteux)" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini (économique)" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "o1-mini", label: "o1-mini (raisonnement)" },
  ],
  anthropic: [
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (rapide)" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4 (premium)" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

export type AiSettingsView = {
  provider: "lovable" | "openai" | "anthropic" | "google";
  model: string;
  use_own_key: boolean;
  has_key: boolean;
  key_last4: string | null;
  key_validated_at: string | null;
  feat_trash: boolean;
  feat_classify: boolean;
  feat_summary: boolean;
  feat_suggestions: boolean;
  feat_voice: boolean;
  feat_assistant: boolean;
  trash_threshold: number;
  encryption_available: boolean;
};

export const getMyAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { isAiEncryptionAvailable } = await import("@/lib/ai/crypto.server");
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("user_ai_settings")
      .select(
        "provider,model,use_own_key,key_last4,key_validated_at,encrypted_api_key,feat_trash,feat_classify,feat_summary,feat_suggestions,feat_voice,feat_assistant,trash_threshold",
      )
      .eq("user_id", userId)
      .maybeSingle();
    const view: AiSettingsView = {
      provider: data?.provider ?? "lovable",
      model: data?.model ?? "google/gemini-3-flash-preview",
      use_own_key: data?.use_own_key ?? false,
      has_key: !!data?.encrypted_api_key,
      key_last4: data?.key_last4 ?? null,
      key_validated_at: data?.key_validated_at ?? null,
      feat_trash: data?.feat_trash ?? true,
      feat_classify: data?.feat_classify ?? true,
      feat_summary: data?.feat_summary ?? true,
      feat_suggestions: data?.feat_suggestions ?? true,
      feat_voice: data?.feat_voice ?? true,
      feat_assistant: data?.feat_assistant ?? true,
      trash_threshold: data?.trash_threshold ?? 70,
      encryption_available: isAiEncryptionAvailable(),
    };
    return view;
  });

const SaveInput = z.object({
  provider: Provider,
  model: z.string().min(1).max(120),
  use_own_key: z.boolean(),
  feat_trash: z.boolean().optional(),
  feat_classify: z.boolean().optional(),
  feat_summary: z.boolean().optional(),
  feat_suggestions: z.boolean().optional(),
  feat_voice: z.boolean().optional(),
  feat_assistant: z.boolean().optional(),
  trash_threshold: z.number().min(50).max(95).optional(),
});

export const saveMyAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = { user_id: userId, ...data };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_settings")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const KeyInput = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(10).max(500),
});

export const saveMyAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => KeyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { isAiEncryptionAvailable, encryptAiKey } = await import("@/lib/ai/crypto.server");
    const { validateProviderKey } = await import("@/lib/ai/provider.server");
    if (!isAiEncryptionAvailable()) {
      throw new Error(
        "Chiffrement IA non configuré. Demandez à l'administrateur d'ajouter le secret AI_KEYS_ENCRYPTION_KEY.",
      );
    }
    const { supabase, userId } = context;
    const validation = await validateProviderKey(data.provider, data.api_key);
    if (!validation.ok) {
      throw new Error(`Clé refusée par ${data.provider} : ${validation.error ?? "invalide"}`);
    }
    const encrypted = encryptAiKey(data.api_key);
    const last4 = data.api_key.slice(-4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_settings")
      .upsert(
        {
          user_id: userId,
          provider: data.provider,
          use_own_key: true,
          encrypted_api_key: encrypted,
          key_last4: last4,
          key_validated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, last4 };
  });

export const deleteMyAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_settings")
      .update({
        encrypted_api_key: null,
        key_last4: null,
        key_validated_at: null,
        use_own_key: false,
        provider: "lovable",
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("ai_call_log")
      .select("provider,used_own_key,status,duration_ms")
      .eq("user_id", userId)
      .gte("created_at", since);
    const rows = (data ?? []) as Array<{
      provider: string;
      used_own_key: boolean;
      status: number | null;
      duration_ms: number | null;
    }>;
    const total = rows.length;
    const ownKey = rows.filter((r) => r.used_own_key).length;
    const errors = rows.filter((r) => (r.status ?? 200) >= 400).length;
    const byProvider: Record<string, number> = {};
    for (const r of rows) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    return { total, ownKey, errors, byProvider };
  });
