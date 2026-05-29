import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

type Priority = (typeof PRIORITIES)[number];
type Category = (typeof CATEGORIES)[number];

type Row = {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  body_text: string | null;
  received_at: string | null;
};

async function classifyOne(
  key: string,
  e: Row,
  hints: string,
): Promise<{ priority: Priority; category: Category; summary: string } | null> {
  const sys = `Tu classes des emails. Réponds UNIQUEMENT en JSON valide:
{"priority":"urgent|important|normal|low","category":"action|rendez-vous|document|facturation|rh|info|newsletter","summary":"résumé en 1-2 phrases (max 200 caractères), français"}
- urgent: action immédiate requise
- important: action cette semaine
- normal: informatif utile
- low: newsletters, notifications automatiques, pub${hints ? `\n\nPRÉFÉRENCES APPRISES de l'utilisateur (à respecter en priorité):\n${hints}` : ""}`;

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
  let parsed: { priority?: string; category?: string; summary?: string } = {};
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
  return { priority, category, summary };
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

    const { data: rows, error } = await supabase
      .from("emails")
      .select("id,subject,from_address,from_name,body_text,received_at")
      .eq("user_id", userId)
      .is("ai_processed_at", null)
      .order("received_at", { ascending: false })
      .limit(8);
    if (error) return { processed: 0, error: error.message };
    if (!rows || rows.length === 0) return { processed: 0 };

    let processed = 0;
    for (const r of rows as Row[]) {
      const result = await classifyOne(key, r, hints);

      const now = new Date().toISOString();
      const update = result
        ? {
            ai_priority: result.priority,
            ai_category: result.category,
            ai_summary: result.summary,
            ai_processed_at: now,
          }
        : { ai_processed_at: now };
      const { error: upErr } = await supabase
        .from("emails")
        .update(update)
        .eq("id", r.id);
      if (!upErr && result) processed++;
    }
    return { processed };
  });
