import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";

const PRIORITIES = ["urgent", "important", "normal", "low"] as const;
const CATEGORIES = [
  "action",
  "rendez-vous",
  "document",
  "facturation",
  "rh",
  "info",
  "newsletter",
] as const;
const SPAM_LABELS = ["legit", "promo", "spam", "phishing"] as const;

type Priority = (typeof PRIORITIES)[number];
type Category = (typeof CATEGORIES)[number];
type SpamLabel = (typeof SPAM_LABELS)[number];

type Row = {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  body_text: string | null;
  received_at: string | null;
};

type ClassifyResult = {
  priority: Priority;
  category: Category;
  summary: string;
  spam_label: SpamLabel;
  spam_score: number;
  spam_reason: string;
};

async function classifyOne(
  key: string,
  e: Row,
  hints: string,
  trustedSenders: string,
  userPromptsBlock: string,
): Promise<ClassifyResult | null> {
  const sys = `Tu classes des emails. Réponds UNIQUEMENT en JSON valide:
{"priority":"urgent|important|normal|low","category":"action|rendez-vous|document|facturation|rh|info|newsletter","summary":"résumé en 1-2 phrases (max 200 caractères), français","spam_label":"legit|promo|spam|phishing","spam_score":0-100,"spam_reason":"raison courte en français (max 80 caractères)"}

PRIORITÉ:
- urgent: action immédiate requise
- important: action cette semaine
- normal: informatif utile
- low: notifications automatiques

SPAM/PROMO (très important):
- legit: email légitime personnel ou professionnel
- promo: newsletter, publicité commerciale, offre promotionnelle (même légitime)
- spam: courrier non sollicité, arnaque évidente, contenu douteux
- phishing: hameçonnage (faux expéditeur, lien suspect, urgence factice, demande de mot de passe/paiement)
- spam_score = confiance (0=sûr legit, 100=sûr indésirable)${trustedSenders ? `\n\nEXPÉDITEURS DE CONFIANCE (toujours legit):\n${trustedSenders}` : ""}${hints ? `\n\nPRÉFÉRENCES APPRISES de l'utilisateur (à respecter en priorité):\n${hints}` : ""}`;

  const user = `Sujet: ${e.subject ?? ""}
De: ${e.from_name ?? ""} <${e.from_address ?? ""}>
Reçu: ${e.received_at ?? ""}

${(e.body_text ?? "").slice(0, 2500)}`;

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
  let parsed: {
    priority?: string;
    category?: string;
    summary?: string;
    spam_label?: string;
    spam_score?: number;
    spam_reason?: string;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const priority = (PRIORITIES as readonly string[]).includes(parsed.priority ?? "")
    ? (parsed.priority as Priority)
    : "normal";
  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "")
    ? (parsed.category as Category)
    : "info";
  const summary = (parsed.summary ?? "").slice(0, 280);
  const spam_label = (SPAM_LABELS as readonly string[]).includes(parsed.spam_label ?? "")
    ? (parsed.spam_label as SpamLabel)
    : "legit";
  const rawScore = typeof parsed.spam_score === "number" ? parsed.spam_score : 0;
  const spam_score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const spam_reason = (parsed.spam_reason ?? "").slice(0, 120);
  return { priority, category, summary, spam_label, spam_score, spam_reason };
}

export const classifyPendingEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { processed: 0, error: "LOVABLE_API_KEY manquant" };

    const { data: feedbacks } = await supabase
      .from("ai_feedback")
      .select("from_address,subject,corrected_priority,corrected_category")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    const hintLines: string[] = [];
    for (const f of feedbacks ?? []) {
      const parts: string[] = [];
      if (f.from_address) parts.push(`expéditeur ${f.from_address}`);
      if (f.subject) parts.push(`sujet contient "${f.subject.slice(0, 60)}"`);
      const target: string[] = [];
      if (f.corrected_priority) target.push(`priorité=${f.corrected_priority}`);
      if (f.corrected_category) target.push(`catégorie=${f.corrected_category}`);
      if (parts.length && target.length) {
        hintLines.push(`- Si ${parts.join(" et ")} → ${target.join(", ")}`);
      }
    }
    const hints = hintLines.slice(0, 20).join("\n");

    const { data: sec } = await supabase
      .from("security_settings")
      .select("whitelist,blacklist")
      .eq("user_id", userId)
      .maybeSingle();
    const whitelist = (sec?.whitelist ?? []) as string[];
    const blacklist = (sec?.blacklist ?? []) as string[];
    const trustedSenders = whitelist.slice(0, 30).map((s) => `- ${s}`).join("\n");

    const { data: rows, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,body_text,received_at")
      .eq("user_id", userId)
      .eq("is_sensitive", false)
      .is("ai_processed_at", null)
      .order("received_at", { ascending: false })
      .limit(8);
    if (error) return { processed: 0, error: error.message };
    if (!rows || rows.length === 0) return { processed: 0 };

    let processed = 0;
    for (const r of rows as Row[]) {
      const result = await classifyOne(key, r, hints, trustedSenders);

      const from = (r.from_address ?? "").toLowerCase();
      const isWhitelisted = whitelist.some((w) => from.includes(w.toLowerCase()));
      const isBlacklisted = blacklist.some((b) => from.includes(b.toLowerCase()));

      const now = new Date().toISOString();
      let update: Partial<{ ai_priority: string; ai_category: string; ai_summary: string; ai_processed_at: string; spam_label: string; spam_score: number; spam_reason: string }>;
      if (result) {
        let spam_label = result.spam_label;
        let spam_score = result.spam_score;
        if (isWhitelisted) { spam_label = "legit"; spam_score = 0; }
        else if (isBlacklisted) { spam_label = "spam"; spam_score = 100; }
        update = {
          ai_priority: result.priority,
          ai_category: result.category,
          ai_summary: result.summary,
          ai_processed_at: now,
          spam_label,
          spam_score,
          spam_reason: result.spam_reason,
        };
      } else {
        update = { ai_processed_at: now };
      }
      const { error: upErr } = await supabase
        .from("emails")
        .update(update)
        .eq("id", r.id);
      if (!upErr && result) processed++;
    }
    return { processed };
  });
