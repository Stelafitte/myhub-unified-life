import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  threshold: z.number().min(50).max(95).default(75),
  limit: z.number().min(5).max(60).default(30),
});

type Suggestion = { id: string; score: number; reason: string };

export const suggestTrashCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { suggestions: [] as Suggestion[], error: "LOVABLE_API_KEY manquant" };

    // Échantillon des choix passés : mails déjà mis à la corbeille + retours utilisateurs
    const { data: trashed } = await supabase
      .from("emails")
      .select("from_address,from_name,subject,ai_category,spam_label")
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(80);

    const { data: feedback } = await supabase
      .from("trash_feedback")
      .select("from_address,subject,decision")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);

    // Mails candidats : non lus / non archivés / non corbeille / non envoyés
    const { data: candidates } = await (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (a: string, b: string) => { is: (a: string, b: null) => { neq: (a: string, b: string) => { order: (a: string, b: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Array<{ id: string; from_address: string | null; from_name: string | null; subject: string | null; ai_category: string | null; ai_summary: string | null; spam_label: string | null; received_at: string | null; direction: string | null }> | null }> } } } } } })
      .from("emails")
      .select("id,from_address,from_name,subject,ai_category,ai_summary,spam_label,received_at,direction")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .neq("direction", "outbound")
      .order("received_at", { ascending: false })
      .limit(data.limit);


    if (!candidates || candidates.length === 0) return { suggestions: [] as Suggestion[] };

    const trashSummary = (trashed ?? [])
      .slice(0, 40)
      .map((t) => `- ${t.from_address ?? "?"} | ${(t.subject ?? "").slice(0, 80)}${t.ai_category ? ` [${t.ai_category}]` : ""}${t.spam_label && t.spam_label !== "legit" ? ` (${t.spam_label})` : ""}`)
      .join("\n");

    const fbKeep = (feedback ?? []).filter((f) => f.decision === "keep")
      .slice(0, 30)
      .map((f) => `- GARDER : ${f.from_address ?? "?"} | ${(f.subject ?? "").slice(0, 70)}`)
      .join("\n");
    const fbTrash = (feedback ?? []).filter((f) => f.decision === "trash")
      .slice(0, 30)
      .map((f) => `- JETER : ${f.from_address ?? "?"} | ${(f.subject ?? "").slice(0, 70)}`)
      .join("\n");

    const candidatesText = candidates.map((c, i) =>
      `${i + 1}. id=${c.id}
   De: ${c.from_name ?? ""} <${c.from_address ?? ""}>
   Sujet: ${(c.subject ?? "").slice(0, 140)}
   Catégorie: ${c.ai_category ?? "?"} | Spam: ${c.spam_label ?? "?"}
   Résumé: ${(c.ai_summary ?? "").slice(0, 160)}`
    ).join("\n\n");

    const sys = `Tu pré-tries des emails à mettre à la corbeille pour un cadre dirigeant occupé.
Réponds UNIQUEMENT en JSON valide:
{"suggestions":[{"id":"<uuid>","score":0-100,"reason":"raison courte FR <60 car."}]}

Critères pour JETER (score élevé) :
- ressemble fortement aux mails déjà jetés (même expéditeur, même type, newsletter, promo, notification automatique)
- spam_label = promo/spam/phishing
- contenu purement marketing, newsletter de masse, alertes système sans valeur

NE PAS jeter (omettre ou score bas) :
- mails personnels, professionnels avec demande d'action, factures, RDV, réponses attendues
- expéditeurs marqués "GARDER" par l'utilisateur

Seuil minimal de confiance demandé : ${data.threshold}. N'inclus que les mails au-dessus.

HISTORIQUE — Mails que l'utilisateur a déjà mis à la corbeille :
${trashSummary || "(aucun)"}

${fbKeep ? `Mails que l'utilisateur a explicitement GARDÉ malgré la suggestion :\n${fbKeep}\n` : ""}${fbTrash ? `Mails que l'utilisateur a explicitement JETÉ via la suggestion :\n${fbTrash}\n` : ""}`;

    const user = `Voici ${candidates.length} mails candidats. Indique ceux à jeter avec leur id exact :

${candidatesText}`;

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
    if (!resp.ok) {
      return { suggestions: [] as Suggestion[], error: `AI ${resp.status}` };
    }
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { suggestions?: Suggestion[] } = {};
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }
    const validIds = new Set(candidates.map((c) => c.id));
    const suggestions = (parsed.suggestions ?? [])
      .filter((s) => s && typeof s.id === "string" && validIds.has(s.id) && typeof s.score === "number" && s.score >= data.threshold)
      .map((s) => ({ id: s.id, score: Math.min(100, Math.max(0, Math.round(s.score))), reason: (s.reason ?? "").slice(0, 80) }));

    return { suggestions };
  });

const FbInput = z.object({
  decisions: z.array(z.object({
    email_id: z.string().uuid(),
    decision: z.enum(["trash", "keep"]),
    ai_score: z.number().optional(),
  })).max(60),
});

export const recordTrashDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FbInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.decisions.length === 0) return { ok: true };
    const ids = data.decisions.map((d) => d.email_id);
    const { data: rows } = await supabase
      .from("emails")
      .select("id,from_address,subject")
      .in("id", ids);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const inserts = data.decisions.map((d) => {
      const r = byId.get(d.email_id);
      return {
        user_id: userId,
        email_id: d.email_id,
        from_address: r?.from_address ?? null,
        subject: r?.subject ?? null,
        decision: d.decision,
        ai_suggested: true,
        ai_score: d.ai_score ?? null,
      };
    });
    const { error } = await supabase.from("trash_feedback").insert(inserts);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
