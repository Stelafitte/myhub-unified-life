import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";
import { z } from "zod";

const InputSchema = z.object({
  text: z.string(),
});

const ResultSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  comments: z.string().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
  due_date: z.string().nullable(),
  gantt_start: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  section: z.string().nullable(),
});

export const analyzeTaskText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { supabase, userId } = context as { supabase: unknown; userId: string };
    const userPromptsBlock = await loadActivePromptsBlock(supabase, userId, ["task_create"]);

    const today = new Date().toISOString();
    const sys = `Tu es un assistant qui analyse le texte brut d'une tâche pour en extraire les métadonnées structurées.
Date de référence : ${today}
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma exact :
{
  "title": "titre amélioré court et actionnable (verbe à l'infinitif, max 80 caractères) ou null si déjà bon",
  "description": "description structurée et complète ou null",
  "comments": "commentaires/contexte utiles ou null",
  "priority": "low | medium | high | urgent",
  "due_date": "YYYY-MM-DD ou null",
  "gantt_start": "YYYY-MM-DD ou null",
  "tags": ["tag1", "tag2"] ou null,
  "section": "CHU | Université | Personnel | Autre ou null"
}
Règles :
- Détecte une échéance explicite (due_date).
- Si une période est mentionnée (du X au Y), gantt_start = date début, due_date = date fin.
- Déduis la priorité : urgent si deadline < 3 jours ou langage urgent, high si < 7 jours, sinon medium/low.
- Choisis la section en fonction du contexte professionnel mentionné.
- N'invente rien. Mets null si tu n'es pas sûr.${userPromptsBlock}`;

    const user = `Texte de la tâche :
${data.text.slice(0, 3000)}`;

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
          { role: "user", content: user },
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
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    return ResultSchema.parse({
      title: (parsed as { title?: string | null }).title ?? null,
      description: (parsed as { description?: string | null }).description ?? null,
      comments: (parsed as { comments?: string | null }).comments ?? null,
      priority: ((parsed as { priority?: string | null }).priority as "low" | "medium" | "high" | "urgent" | null) ?? null,
      due_date: (parsed as { due_date?: string | null }).due_date ?? null,
      gantt_start: (parsed as { gantt_start?: string | null }).gantt_start ?? null,
      tags: (parsed as { tags?: string[] | null }).tags ?? null,
      section: (parsed as { section?: string | null }).section ?? null,
    });
  });
