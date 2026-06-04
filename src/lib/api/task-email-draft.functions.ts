import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";
import { z } from "zod";

const InputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional().nullable(),
  comments: z.string().max(20000).optional().nullable(),
  attachments: z.array(z.string().max(255)).max(50).optional(),
});

const ResultSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export const generateTaskEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { supabase, userId } = context as { supabase: unknown; userId: string };
    const userPromptsBlock = await loadActivePromptsBlock(supabase, userId, ["email_reply", "task_create"]);

    const sys = `Tu rédiges un email professionnel en français à partir d'une tâche.
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma :
{
  "subject": "objet d'email clair et concis (max 100 caractères)",
  "body": "corps de l'email, ton professionnel, sans formule de signature à la fin (la signature est ajoutée automatiquement)"
}
Règles :
- Commence par une formule de politesse courte (ex: "Bonjour,").
- Mentionne brièvement le contexte/objet de la tâche.
- Si des pièces jointes sont listées, indique qu'elles sont jointes.
- Termine par "Cordialement," mais SANS le nom — la signature sera ajoutée.
- N'invente pas de noms de destinataires.${userPromptsBlock}`;

    const lines: string[] = [`Titre: ${data.title}`];
    if (data.description) lines.push(`Description:\n${data.description}`);
    if (data.comments) lines.push(`Commentaires:\n${data.comments}`);
    if (data.attachments && data.attachments.length > 0) {
      lines.push(`Pièces jointes:\n- ${data.attachments.join("\n- ")}`);
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: lines.join("\n\n") },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`AI gateway: ${resp.status} ${text.slice(0, 200)}`);
    }
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { subject?: string; body?: string } = {};
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }
    return ResultSchema.parse({
      subject: parsed.subject ?? data.title,
      body: parsed.body ?? "",
    });
  });
