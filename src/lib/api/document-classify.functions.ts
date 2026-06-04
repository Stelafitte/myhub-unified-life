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
  original_filename: string | null;
  mime_type: string | null;
  file_size: number;
  source_type: string;
  source_id: string | null;
  description: string | null;
};

type SourceContext = {
  subject?: string | null;
  from_address?: string | null;
  from_name?: string | null;
  snippet?: string | null;
};

async function classifyOne(
  key: string,
  d: DocRow,
  userPromptsBlock: string,
  ctx: SourceContext | null,
): Promise<{ category: Category; priority: Priority; summary: string } | null> {
  const sys = `Tu classes des documents bureautiques. Réponds UNIQUEMENT en JSON valide:
{"category":"facture|contrat|rapport|presentation|courrier|rh|technique|image|signature|autre","priority":"urgent|important|normal|low","summary":"résumé en 1 phrase (max 160 caractères), français"}

CATÉGORIES (élargies — utilise tout indice du nom de fichier OU de l'email source) :
- facture: facture, invoice, receipt, reçu, devis, quote, estimate, note de frais, billing, statement, payment, paiement
- contrat: contrat, contract, convention, agreement, accord, NDA, avenant
- rapport: rapport, report, étude, analyse, compte-rendu, audit, bilan
- presentation: slides, pitch deck, présentation, keynote
- courrier: lettre, courrier, email exporté, correspondance
- rh: CV, resume, fiche de paie, payslip, attestation, contrat de travail
- technique: doc technique, spec, plan, schéma, manuel, notice
- image: photo, illustration, capture d'écran utile
- signature: image de signature email, logo de pied de mail, bannière promotionnelle sans intérêt
- autre: ne correspond à rien

Examine le nom de fichier, l'extension, l'expéditeur et le sujet de l'email source si fourni. Les mots-clés peuvent être en français OU en anglais.
PRIORITÉ basée sur l'importance probable du document.${userPromptsBlock}

IMPORTANT : si les "Instructions personnalisées de l'utilisateur" ci-dessus donnent des règles de classement (mots-clés, expéditeurs, catégories), elles PRIMENT sur tes propres heuristiques.`;

  const lines = [
    `Nom: ${d.filename}`,
    d.original_filename && d.original_filename !== d.filename ? `Nom original: ${d.original_filename}` : null,
    `Type MIME: ${d.mime_type ?? "inconnu"}`,
    `Taille: ${Math.round(d.file_size / 1024)} Ko`,
    `Source: ${d.source_type}`,
    d.description ? `Description: ${d.description}` : null,
    ctx?.from_address ? `Email expéditeur: ${ctx.from_name ? `${ctx.from_name} <${ctx.from_address}>` : ctx.from_address}` : null,
    ctx?.subject ? `Email sujet: ${ctx.subject}` : null,
    ctx?.snippet ? `Email extrait: ${ctx.snippet.slice(0, 400)}` : null,
  ].filter(Boolean);
  const user = lines.join("\n");

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
      .select("id,filename,original_filename,mime_type,file_size,source_type,source_id,description")
      .eq("user_id", userId)
      .is("ai_processed_at", null)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) return { processed: 0, skipped: 0, error: error.message };
    if (!rows || rows.length === 0) return { processed: 0, skipped: 0 };

    const userPromptsBlock = await loadActivePromptsBlock(supabase, userId, ["document"]);

    // Pré-charge le contexte des emails sources en un seul appel
    const emailIds = Array.from(new Set(
      (rows as DocRow[])
        .filter((r) => r.source_type === "email" && r.source_id)
        .map((r) => r.source_id as string),
    ));
    const emailCtx = new Map<string, SourceContext>();
    if (emailIds.length > 0) {
      const { data: emails } = await supabase
        .from("emails")
        .select("id,subject,from_address,from_name,body_text")
        .in("id", emailIds);
      for (const e of (emails ?? []) as Array<{ id: string; subject: string | null; from_address: string | null; from_name: string | null; body_text: string | null }>) {
        emailCtx.set(e.id, {
          subject: e.subject,
          from_address: e.from_address,
          from_name: e.from_name,
          snippet: e.body_text,
        });
      }
    }

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
      const ctx = r.source_id ? emailCtx.get(r.source_id) ?? null : null;
      const result = await classifyOne(key, r, userPromptsBlock, ctx);
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
