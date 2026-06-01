import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- Types ----------

export type ThemeUtility = "faible" | "modere" | "fort";
export type ThemeScope = "pro" | "perso";

export type Theme = {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  source: "ai" | "onedrive" | "manual";
  icon: string | null;
  archived_at: string | null;
  email_count: number;
  last_email_at: string | null;
  utility_level: ThemeUtility;
  scope: ThemeScope;
};

// ---------- List ----------

export const listThemes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("email_themes")
      .select("*")
      .eq("user_id", userId)
      .order("email_count", { ascending: false });
    if (error) return { themes: [] as Theme[], error: error.message };
    return { themes: (data ?? []) as Theme[] };
  });

// ---------- Discover ----------
// Analyses recent emails + optional folder hints via AI to propose a starter list of themes.

function discoverSystemPrompt(maxThemes: number) {
  return `Tu es un assistant qui analyse les emails d'un professionnel pour en extraire les principaux THÈMES MÉTIER (projets, dossiers, sujets récurrents).

Règles:
- Propose entre 5 et ${maxThemes} thèmes maximum, distincts et non redondants.
- Un thème = un sujet métier précis (ex: "Congrès Bordeaux 2026", "Cabinet Bodin - Divorce", "Prestataires IT", "SFC", "ODP2C").
- IGNORE les catégories génériques type "Newsletters", "Notifications", "Personnel".
- Pour chaque thème, donne 3 à 6 mots-clés discriminants (noms propres, sigles, adresses email partielles, projets).
- Réponds UNIQUEMENT en JSON valide:
{"themes":[{"name":"...","description":"...","keywords":["...","..."]}]}`;
}


const DiscoverInput = z.object({ maxThemes: z.number().int().min(3).max(20).optional() }).optional();

async function runDiscover(
  supabase: any,
  userId: string,
  maxThemes: number,
): Promise<{ created: number; error?: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { created: 0, error: "LOVABLE_API_KEY manquant" };

  const { data: rows } = await supabase
    .from("emails")
    .select("subject,from_address,from_name,ai_summary")
    .eq("user_id", userId)
    .eq("is_sensitive", false)
    .order("received_at", { ascending: false })
    .limit(200);

  if (!rows || rows.length === 0) return { created: 0, error: "Pas assez d'emails pour analyser" };

  const sample = rows
    .map(
      (r: any) =>
        `• ${r.subject ?? "(sans sujet)"} — de ${r.from_name ?? ""} <${r.from_address ?? ""}>${r.ai_summary ? ` | ${r.ai_summary}` : ""}`,
    )
    .join("\n")
    .slice(0, 14000);

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: discoverSystemPrompt(maxThemes) },
        { role: "user", content: `Voici un échantillon de ${rows.length} emails récents:\n\n${sample}` },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) return { created: 0, error: `AI ${resp.status}` };
  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content ?? "{}";

  let parsed: { themes?: { name: string; description?: string; keywords?: string[] }[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { created: 0, error: "Réponse IA invalide" };
  }

  const themes = (parsed.themes ?? []).filter((t) => t.name && t.name.length > 1).slice(0, maxThemes);
  if (themes.length === 0) return { created: 0 };

  let created = 0;
  for (const t of themes) {
    const { error } = await supabase.from("email_themes").upsert(
      {
        user_id: userId,
        name: t.name.slice(0, 80),
        description: (t.description ?? "").slice(0, 280),
        keywords: (t.keywords ?? []).slice(0, 10),
        source: "ai",
        archived_at: null,
      },
      { onConflict: "user_id,name" },
    );
    if (!error) created++;
  }
  return { created };
}

export const discoverThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DiscoverInput.parse(input))
  .handler(async ({ data, context }) => {
    return runDiscover(context.supabase, context.userId, data?.maxThemes ?? 12);
  });

// ---------- Refine from scratch ----------
// Archive existing themes, clear sender map, reset all emails, then regenerate
// up to N themes (default 15) from a fresh sample.

const RefineInput = z.object({ maxThemes: z.number().int().min(5).max(20).optional() }).optional();

export const refineThemesFromScratch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RefineInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const maxThemes = data?.maxThemes ?? 15;

    // 1. Reset all emails' classification
    const { error: resetErr } = await supabase
      .from("emails")
      .update({ ai_theme_id: null, theme_processed_at: null })
      .eq("user_id", userId);
    if (resetErr) return { ok: false, created: 0, error: resetErr.message };

    // 2. Clear sender memory so the IA re-decides
    await supabase.from("sender_theme_map").delete().eq("user_id", userId);

    // 3. Archive existing AI themes (keep manual/onedrive ones available but archived too,
    //    so the new list is clean — user can unarchive if needed).
    await supabase
      .from("email_themes")
      .update({ archived_at: new Date().toISOString(), email_count: 0 })
      .eq("user_id", userId)
      .is("archived_at", null);

    // 4. Regenerate fresh themes
    const res = await runDiscover(supabase, userId, maxThemes);
    return { ok: !res.error, created: res.created, error: res.error };
  });


// ---------- Seed from OneDrive folders ----------

const SeedFromFoldersInput = z.object({
  folders: z
    .array(z.object({ name: z.string().min(1), path: z.string().min(1), depth: z.number().optional() }))
    .max(200),
});

export const seedThemesFromFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SeedFromFoldersInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const STOP = new Set([
      "documents", "perso", "personnel", "personal", "divers", "archive", "archives",
      "backup", "tmp", "temp", "old", "images", "photos", "videos", "musique",
      "downloads", "desktop", "bureau", "shared", "attachments",
    ]);
    let created = 0;
    for (const f of data.folders) {
      const name = f.name.trim();
      if (name.length < 3 || STOP.has(name.toLowerCase())) continue;
      if ((f.depth ?? 0) > 1) continue;
      const { error } = await supabase.from("email_themes").upsert(
        {
          user_id: userId,
          name: name.slice(0, 80),
          description: `Dossier OneDrive: ${f.path}`,
          keywords: [name.toLowerCase()],
          source: "onedrive",
        },
        { onConflict: "user_id,name", ignoreDuplicates: true },
      );
      if (!error) created++;
    }
    return { created };
  });

// ---------- Classify pending emails ----------

const CLASSIFY_SYS = `Tu assignes un email à UN thème métier parmi une liste donnée.

Règles:
- Lis attentivement sujet + expéditeur + contenu/résumé.
- Si un thème de la liste correspond clairement, retourne son nom EXACT.
- Si aucun thème ne correspond mais qu'un nouveau thème métier précis émerge (projet, dossier client, sigle récurrent), propose-le.
- N'invente PAS un thème générique ("Email", "Information"). Laisse vide plutôt.
- Réponds UNIQUEMENT en JSON:
{"theme":"NOM_EXISTANT" | null, "new_theme": {"name":"...","description":"...","keywords":["..."]} | null}`;

export const classifyPendingThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { processed: 0, error: "LOVABLE_API_KEY manquant" };

    // Load themes
    const { data: themesRows } = await supabase
      .from("email_themes")
      .select("id,name,description,keywords")
      .eq("user_id", userId)
      .is("archived_at", null);
    const themes = (themesRows ?? []) as { id: string; name: string; description: string | null; keywords: string[] }[];
    const themeByName = new Map(themes.map((t) => [t.name.toLowerCase(), t]));

    // Load sender memory
    const { data: senderRows } = await supabase
      .from("sender_theme_map")
      .select("from_address,theme_id")
      .eq("user_id", userId);
    const senderMap = new Map((senderRows ?? []).map((s) => [s.from_address.toLowerCase(), s.theme_id]));

    // Pending emails
    const { data: rows, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,body_text,ai_summary,received_at")
      .eq("user_id", userId)
      .eq("is_sensitive", false)
      .is("theme_processed_at", null)
      .order("received_at", { ascending: false })
      .limit(8);
    if (error) return { processed: 0, error: error.message };
    if (!rows || rows.length === 0) return { processed: 0 };

    const themeList = themes
      .map((t) => `- "${t.name}"${t.description ? `: ${t.description}` : ""}${t.keywords.length ? ` [mots-clés: ${t.keywords.join(", ")}]` : ""}`)
      .join("\n");

    let processed = 0;
    for (const r of rows) {
      let themeId: string | null = null;
      const sender = (r.from_address ?? "").toLowerCase();

      // 1. Sender memory override (no AI)
      if (sender && senderMap.has(sender)) {
        themeId = senderMap.get(sender) ?? null;
      }

      // 2. AI classification
      if (!themeId) {
        const user = `THÈMES EXISTANTS:
${themeList || "(aucun)"}

EMAIL À CLASSER:
Sujet: ${r.subject ?? ""}
De: ${r.from_name ?? ""} <${r.from_address ?? ""}>
${r.ai_summary ? `Résumé: ${r.ai_summary}\n` : ""}Contenu:
${(r.body_text ?? "").slice(0, 1500)}`;

        try {
          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: CLASSIFY_SYS },
                { role: "user", content: user },
              ],
              response_format: { type: "json_object" },
            }),
          });
          if (resp.ok) {
            const json = await resp.json();
            const raw = json?.choices?.[0]?.message?.content ?? "{}";
            const parsed = JSON.parse(raw) as {
              theme?: string | null;
              new_theme?: { name: string; description?: string; keywords?: string[] } | null;
            };
            if (parsed.theme) {
              const match = themeByName.get(parsed.theme.toLowerCase());
              if (match) themeId = match.id;
            }
            if (!themeId && parsed.new_theme?.name) {
              const nt = parsed.new_theme;
              const { data: inserted } = await supabase
                .from("email_themes")
                .upsert(
                  {
                    user_id: userId,
                    name: nt.name.slice(0, 80),
                    description: (nt.description ?? "").slice(0, 280),
                    keywords: (nt.keywords ?? []).slice(0, 10),
                    source: "ai",
                  },
                  { onConflict: "user_id,name" },
                )
                .select("id,name,description,keywords")
                .single();
              if (inserted) {
                themeId = inserted.id;
                themes.push(inserted as typeof themes[number]);
                themeByName.set(inserted.name.toLowerCase(), inserted as typeof themes[number]);
              }
            }
          }
        } catch {
          /* ignore — mark as processed anyway to avoid loops */
        }
      }

      const now = new Date().toISOString();
      await supabase
        .from("emails")
        .update({ ai_theme_id: themeId, theme_processed_at: now })
        .eq("id", r.id);

      if (themeId) {
        await supabase
          .from("email_themes")
          .update({ last_email_at: r.received_at ?? now })
          .eq("id", themeId);
      }
      processed++;
    }

    // Refresh counters
    await refreshThemeCounts(supabase, userId);

    return { processed };
  });

// ---------- Manual overrides ----------

async function refreshThemeCounts(
  supabase: { rpc?: unknown; from: (t: string) => ReturnType<typeof Object> } & any,
  userId: string,
) {
  // Per-theme count via group by would need an RPC; do it client-side cheaply.
  const { data: counts } = await supabase
    .from("emails")
    .select("ai_theme_id")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .not("ai_theme_id", "is", null);
  const map = new Map<string, number>();
  for (const r of (counts ?? []) as { ai_theme_id: string | null }[]) {
    if (!r.ai_theme_id) continue;
    map.set(r.ai_theme_id, (map.get(r.ai_theme_id) ?? 0) + 1);
  }
  const { data: themeIds } = await supabase
    .from("email_themes")
    .select("id")
    .eq("user_id", userId);
  for (const t of (themeIds ?? []) as { id: string }[]) {
    await supabase.from("email_themes").update({ email_count: map.get(t.id) ?? 0 }).eq("id", t.id);
  }
}

const SetEmailThemeInput = z.object({
  emailId: z.string().uuid(),
  themeId: z.string().uuid().nullable(),
  memorizeSender: z.boolean().default(true),
});

export const setEmailTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetEmailThemeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: em } = await supabase
      .from("emails")
      .select("from_address")
      .eq("id", data.emailId)
      .eq("user_id", userId)
      .single();
    if (!em) return { ok: false, error: "Email introuvable" };

    await supabase
      .from("emails")
      .update({ ai_theme_id: data.themeId, theme_processed_at: new Date().toISOString() })
      .eq("id", data.emailId);

    if (data.memorizeSender && em.from_address && data.themeId) {
      await supabase.from("sender_theme_map").upsert(
        { user_id: userId, from_address: em.from_address.toLowerCase(), theme_id: data.themeId },
        { onConflict: "user_id,from_address" },
      );
    }
    await refreshThemeCounts(supabase, userId);
    return { ok: true };
  });

// ---------- CRUD on themes ----------

const CreateThemeInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  keywords: z.array(z.string()).max(10).optional(),
});

export const createTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateThemeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("email_themes")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description ?? null,
        keywords: data.keywords ?? [],
        source: "manual",
      })
      .select("*")
      .single();
    if (error) return { theme: null, error: error.message };
    return { theme: row as Theme };
  });

const RenameInput = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) });
export const renameTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RenameInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("email_themes")
      .update({ name: data.name })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const archiveTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("email_themes")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message };
  });

export const unarchiveTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("email_themes")
      .update({ archived_at: null })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message };
  });

export const deleteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Detach emails first (FK is ON DELETE SET NULL but reset processed_at so they'll be reclassified)
    await supabase
      .from("emails")
      .update({ ai_theme_id: null, theme_processed_at: null })
      .eq("user_id", userId)
      .eq("ai_theme_id", data.id);
    const { error } = await supabase
      .from("email_themes")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error, error: error?.message };
  });

const MergeInput = z.object({ fromId: z.string().uuid(), intoId: z.string().uuid() });
export const mergeThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MergeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.fromId === data.intoId) return { ok: false, error: "Identique" };
    await supabase
      .from("emails")
      .update({ ai_theme_id: data.intoId })
      .eq("user_id", userId)
      .eq("ai_theme_id", data.fromId);
    await supabase
      .from("sender_theme_map")
      .update({ theme_id: data.intoId })
      .eq("user_id", userId)
      .eq("theme_id", data.fromId);
    await supabase.from("email_themes").delete().eq("id", data.fromId).eq("user_id", userId);
    await refreshThemeCounts(supabase, userId);
    return { ok: true };
  });
