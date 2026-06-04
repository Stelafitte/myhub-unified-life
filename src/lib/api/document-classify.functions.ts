import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";

const CATEGORIES = [
  "facture",
  "contrat",
  "rapport",
  "presentation",
  "courrier",
  "rh",
  "technique",
  "image",
  "signature",
  "autre",
] as const;
const PRIORITIES = ["urgent", "important", "normal", "low"] as const;

type Category = (typeof CATEGORIES)[number];
type Priority = (typeof PRIORITIES)[number];

type DocRow = {
  id: string;
  filename: string;
  mime_type: string | null;
  file_size: number;
  source_type: string;
  description: string | null;
};

async function classifyOne(
  key: string,
  d: DocRow,
): Promise<{ category: Category; priority: Priority; summary: string } | null> {
  const sys = `Tu classes des documents bureautiques. Réponds UNIQUEMENT en JSON valide:
{"category":"facture|contrat|rapport|presentation|courrier|rh|technique|image|signature|autre","priority":"urgent|important|normal|low","summary":"résumé en 1 phrase (max 160 caractères), français"}

CATÉGORIES:
- facture: facture, devis, reçu, note de frais
- contrat: contrat, convention, accord, NDA
- rapport: rapport, étude, analyse, compte-rendu
- presentation: slides, pitch deck
- courrier: lettre, email exporté, correspondance
- rh: CV, fiche de paie, attestation, contrat de travail
- technique: doc technique, spec, plan, schéma
- image: photo, illustration, capture d'écran utile
- signature: image de signature email, logo de pied de mail, bannière promotionnelle sans intérêt
- autre: ne correspond à rien

PRIORITÉ basée sur l'importance probable du document.`;

  const user = `Nom: ${d.filename}
Type MIME: ${d.mime_type ?? "inconnu"}
Taille: ${Math.round(d.file_size / 1024)} Ko
Source: ${d.source_type}
${d.description ? `Description: ${d.description}` : ""}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  const raw = json?.choices?.[0]?.message?.content ?? "{}";
  let parsed: { category?: string; priority?: string; summary?: string } = {};
  try { parsed = JSON.parse(raw); } catch { return null; }
  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "")
    ? (parsed.category as Category) : "autre";
  const priority = (PRIORITIES as readonly string[]).includes(parsed.priority ?? "")
    ? (parsed.priority as Priority) : "normal";
  const summary = (parsed.summary ?? "").slice(0, 200);
  return { category, priority, summary };
}

export const classifyPendingDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { processed: 0, skipped: 0, error: "LOVABLE_API_KEY manquant" };

    const { data: settings } = await supabase
      .from("document_retention_settings")
      .select("ai_min_size_kb")
      .eq("user_id", userId)
      .maybeSingle();
    const minSizeKb = settings?.ai_min_size_kb ?? 30;
    const minSizeBytes = minSizeKb * 1024;

    const { data: rows, error } = await supabase
      .from("documents")
      .select("id,filename,mime_type,file_size,source_type,description")
      .eq("user_id", userId)
      .is("ai_processed_at", null)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) return { processed: 0, skipped: 0, error: error.message };
    if (!rows || rows.length === 0) return { processed: 0, skipped: 0 };

    let processed = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const r of rows as DocRow[]) {
      // Auto-skip any small file (signatures, logos, icônes, fragments…)
      if (r.file_size < minSizeBytes) {
        const isImage = (r.mime_type ?? "").startsWith("image/");
        await supabase.from("documents").update({
          ai_processed_at: now,
          ai_category: isImage ? "signature" : "autre",
          ai_priority: "low",
          ai_summary: `Fichier < ${minSizeKb} Ko — ignoré (probablement sans intérêt)`,
          ai_skipped_reason: "small_file",
        }).eq("id", r.id);
        skipped++;
        continue;
      }
      const result = await classifyOne(key, r);
      if (result) {
        await supabase.from("documents").update({
          ai_processed_at: now,
          ai_category: result.category,
          ai_priority: result.priority,
          ai_summary: result.summary,
        }).eq("id", r.id);
        processed++;
      } else {
        await supabase.from("documents").update({ ai_processed_at: now }).eq("id", r.id);
      }
    }
    return { processed, skipped };
  });
