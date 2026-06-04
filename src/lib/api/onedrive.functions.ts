import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/microsoft_onedrive";

export type OneDriveFolder = {
  id: string;
  name: string;
  /** Full path from root, e.g. "Travail/SFC/Réunions" */
  path: string;
  /** Depth from root (0 = top-level folder). */
  depth: number;
  childCount: number;
};

type GraphItem = {
  id: string;
  name: string;
  folder?: { childCount?: number };
};

function gwHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.MICROSOFT_ONEDRIVE_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY manquant");
  if (!connKey) throw new Error("OneDrive non connecté — ajoute le connecteur Microsoft OneDrive.");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
  };
}

/**
 * Recursive listing (used by AI matching). Capped at 3 levels / 500 folders.
 */
export const listOneDriveFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const headers = gwHeaders();

    const MAX_DEPTH = 3;
    const MAX_TOTAL = 500;
    const folders: OneDriveFolder[] = [];

    async function listChildren(itemId: string | "root"): Promise<GraphItem[]> {
      const url =
        itemId === "root"
          ? `${GATEWAY_URL}/me/drive/root/children?$top=200&$select=id,name,folder`
          : `${GATEWAY_URL}/me/drive/items/${itemId}/children?$top=200&$select=id,name,folder`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        console.warn(`OneDrive ${itemId} ${r.status}: ${await r.text().catch(() => "")}`);
        return [];
      }
      const j = (await r.json()) as { value?: GraphItem[] };
      return (j.value ?? []).filter((it) => it.folder);
    }

    async function walk(parentId: string | "root", parentPath: string, depth: number) {
      if (folders.length >= MAX_TOTAL) return;
      const children = await listChildren(parentId);
      const slice = children.slice(0, depth === 0 ? 100 : 30);
      const subs: { id: string; path: string }[] = [];
      for (const f of slice) {
        if (folders.length >= MAX_TOTAL) break;
        const path = parentPath ? `${parentPath}/${f.name}` : f.name;
        folders.push({
          id: f.id,
          name: f.name,
          path,
          depth,
          childCount: f.folder?.childCount ?? 0,
        });
        if (depth + 1 < MAX_DEPTH && (f.folder?.childCount ?? 0) > 0) {
          subs.push({ id: f.id, path });
        }
      }
      await Promise.all(subs.map((s) => walk(s.id, s.path, depth + 1)));
    }

    await walk("root", "", 0);

    return { folders };
  });

/**
 * List direct children of one folder (lazy navigation).
 * Use "root" to list top-level folders.
 */
export const listOneDriveChildren = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ parentId: z.string().min(1).max(256) }).parse(d),
  )
  .handler(async ({ data }) => {
    const headers = gwHeaders();
    const url =
      data.parentId === "root"
        ? `${GATEWAY_URL}/me/drive/root/children?$top=200&$select=id,name,folder`
        : `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(data.parentId)}/children?$top=200&$select=id,name,folder`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      throw new Error(`OneDrive ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    }
    const j = (await r.json()) as { value?: GraphItem[] };
    const children = (j.value ?? [])
      .filter((it) => it.folder)
      .map((f) => ({
        id: f.id,
        name: f.name,
        childCount: f.folder?.childCount ?? 0,
      }));
    return { children };
  });

/**
 * Create a subfolder inside a parent folder ("root" allowed).
 */
export const createOneDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      parentId: z.string().min(1).max(256),
      name: z.string().min(1).max(120).regex(/^[^"*:<>?/\\|]+$/, "Caractères interdits"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const headers = { ...gwHeaders(), "Content-Type": "application/json" };
    const url =
      data.parentId === "root"
        ? `${GATEWAY_URL}/me/drive/root/children`
        : `${GATEWAY_URL}/me/drive/items/${encodeURIComponent(data.parentId)}/children`;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: data.name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
    if (!r.ok) throw new Error(`OneDrive création ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const j = (await r.json()) as { id: string; name: string };
    return { id: j.id, name: j.name };
  });

/**
 * Ask Lovable AI to pick the top 3 OneDrive folders for a given file.
 * Returns folder paths (which we map back to ids client-side).
 */
export const suggestOneDriveFolderAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      filename: z.string().min(1).max(255),
      mimeType: z.string().max(120).optional(),
      subject: z.string().max(500).optional(),
      fromAddress: z.string().max(255).optional(),
      bodyHint: z.string().max(1500).optional(),
      emailId: z.string().uuid().optional(),
      paths: z.array(z.string().min(1).max(500)).min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const { supabase, userId } = context;

    // Resolve theme for this email (if any) to enrich the prompt + history lookup
    let themeId: string | null = null;
    let themeName: string | null = null;
    if (data.emailId) {
      const { data: em } = await supabase
        .from("emails")
        .select("ai_theme_id, ai_category")
        .eq("id", data.emailId)
        .maybeSingle();
      themeId = (em?.ai_theme_id as string | null) ?? null;
      if (themeId) {
        const { data: th } = await supabase
          .from("email_themes")
          .select("name")
          .eq("id", themeId)
          .maybeSingle();
        themeName = (th?.name as string | null) ?? null;
      }
    }

    // Past user choices for similar context — strongest learning signal
    const pathSet = new Set(data.paths);
    const orParts: string[] = [];
    if (themeId) orParts.push(`theme_id.eq.${themeId}`);
    if (data.fromAddress) orParts.push(`from_address.eq.${data.fromAddress.toLowerCase()}`);
    let historyPaths: string[] = [];
    if (orParts.length > 0) {
      const { data: hist } = await supabase
        .from("folder_routing_history")
        .select("folder_path, created_at")
        .eq("user_id", userId)
        .or(orParts.join(","))
        .order("created_at", { ascending: false })
        .limit(20);
      historyPaths = Array.from(
        new Set((hist ?? []).map((h: { folder_path: string }) => h.folder_path)),
      ).filter((p) => pathSet.has(p)).slice(0, 5);
    }

    const sys = `Tu aides à ranger un fichier dans OneDrive. Tu reçois une liste de chemins de dossiers existants et le contexte du fichier. Tu réponds UNIQUEMENT en JSON valide:
{"picks":[{"path":"chemin/exact/copie","reason":"justification courte en français (max 100 caractères)","score":0-100}]}
Règles:
- 1 à 3 résultats max, classés par pertinence.
- "path" doit correspondre EXACTEMENT à un chemin fourni (respecte casse, accents, /).
- Si l'historique utilisateur contient un dossier déjà utilisé pour un contexte similaire (même thème ou même expéditeur), il doit être en tête avec un score élevé.
- Préfère un dossier précis à un dossier générique quand c'est cohérent.
- score = confiance globale.`;

    const user = `Fichier: ${data.filename}${data.mimeType ? ` (${data.mimeType})` : ""}
Sujet email: ${data.subject ?? "—"}
Expéditeur: ${data.fromAddress ?? "—"}
Thème IA: ${themeName ?? "—"}
${data.bodyHint ? `Extrait: ${data.bodyHint}` : ""}

${historyPaths.length > 0 ? `Historique utilisateur (déjà choisis pour un contexte similaire):
${historyPaths.map((p) => `★ ${p}`).join("\n")}

` : ""}Dossiers disponibles (chemin):
${data.paths.slice(0, 400).map((p) => `- ${p}`).join("\n")}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      return { picks: [] as { path: string; reason: string; score: number }[] };
    }
    const j = await resp.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { picks?: { path?: string; reason?: string; score?: number }[] } = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const picks = (parsed.picks ?? [])
      .filter((p) => p.path && pathSet.has(p.path))
      .slice(0, 3)
      .map((p) => ({
        path: p.path as string,
        reason: (p.reason ?? "").slice(0, 140),
        score: Math.max(0, Math.min(100, Math.round(p.score ?? 0))),
      }));
    return { picks };
  });

/**
 * Persist the user's choice (folder path + email/theme context) so the AI
 * can learn from past routing decisions.
 */
export const recordFolderChoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      folderId: z.string().min(1).max(256).optional(),
      folderPath: z.string().min(1).max(500),
      filename: z.string().max(255).optional(),
      mimeType: z.string().max(120).optional(),
      emailId: z.string().uuid().optional(),
      fromAddress: z.string().max(255).optional(),
      subject: z.string().max(500).optional(),
      aiSuggested: z.boolean().default(false),
      aiScore: z.number().int().min(0).max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let themeId: string | null = null;
    let themeName: string | null = null;
    if (data.emailId) {
      const { data: em } = await supabase
        .from("emails")
        .select("ai_theme_id")
        .eq("id", data.emailId)
        .maybeSingle();
      themeId = (em?.ai_theme_id as string | null) ?? null;
      if (themeId) {
        const { data: th } = await supabase
          .from("email_themes")
          .select("name")
          .eq("id", themeId)
          .maybeSingle();
        themeName = (th?.name as string | null) ?? null;
      }
    }

    const { error } = await supabase.from("folder_routing_history").insert({
      user_id: userId,
      provider: "onedrive",
      folder_id: data.folderId ?? null,
      folder_path: data.folderPath,
      filename: data.filename ?? null,
      mime_type: data.mimeType ?? null,
      from_address: data.fromAddress?.toLowerCase() ?? null,
      subject: data.subject ?? null,
      theme_id: themeId,
      theme_name: themeName,
      ai_suggested: data.aiSuggested,
      ai_score: data.aiScore ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

