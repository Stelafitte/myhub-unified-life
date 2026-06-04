import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";
import { z } from "zod";

const InputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  taskTitle: z.string().nullable().optional(),
  taskDescription: z.string().nullable().optional(),
});

const ActionSchema = z.object({
  type: z.enum(["search_emails", "append_note"]),
  label: z.string(),
  args: z
    .object({
      query: z.string().nullable().optional(),
      from: z.string().nullable().optional(),
      subject: z.string().nullable().optional(),
      since_days: z.number().nullable().optional(),
      limit: z.number().nullable().optional(),
      text: z.string().nullable().optional(),
    })
    .default({}),
});

const PlanSchema = z.object({
  actions: z.array(ActionSchema).max(8),
  reply: z.string().optional(),
});

export type AutomationAction = z.infer<typeof ActionSchema>;
export type AutomationPlan = z.infer<typeof PlanSchema>;

export const planTaskAutomation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const sys = `Tu es un assistant qui transforme la demande d'un utilisateur en un plan
d'actions automatiques exécutables sur une tâche.

Actions disponibles :
- "search_emails" : rechercher des mails. args possibles :
    query (mots-clés sujet/corps), from (expéditeur partiel), subject (sujet),
    since_days (entier, ex 30 = derniers 30 jours), limit (entier, défaut 10)
- "append_note" : ajouter une note de contexte à la tâche. args: { text }

Réponds UNIQUEMENT en JSON valide :
{
  "reply": "courte phrase expliquant ce que tu vas faire",
  "actions": [ { "type": "...", "label": "libellé court FR", "args": {...} } ]
}
Tu peux planifier plusieurs actions. Si la demande est vague, propose au moins
une recherche de mail pertinente.`;

    const ctx = `Tâche : ${data.taskTitle ?? "(sans titre)"}
Description : ${(data.taskDescription ?? "").slice(0, 600)}

Demande de l'utilisateur :
${data.prompt}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: ctx },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429) throw new Error("Limite IA atteinte, réessaie dans un instant.");
      if (resp.status === 402) throw new Error("Crédits IA épuisés.");
      throw new Error(`AI gateway: ${resp.status} ${text.slice(0, 200)}`);
    }

    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const safe = PlanSchema.parse({
      reply: (parsed as { reply?: string }).reply ?? "",
      actions: Array.isArray((parsed as { actions?: unknown[] }).actions)
        ? (parsed as { actions: unknown[] }).actions
        : [],
    });
    return safe;
  });
