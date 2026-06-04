import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActivePromptsBlock } from "./_ai-prompts";
import { z } from "zod";

const InputSchema = z.object({
  subject: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  receivedAt: z.string().nullable().optional(),
});

const ResultSchema = z.object({
  title: z.string(),
  summary: z.string(),
  comments: z.string(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  due_date: z.string().nullable(),
  has_event: z.boolean(),
  event_start: z.string().nullable(),
  event_end: z.string().nullable(),
  event_title: z.string().nullable(),
});

export const analyzeEmailForTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { supabase, userId } = context as { supabase: unknown; userId: string };
    const userPromptsBlock = await loadActivePromptsBlock(supabase, userId, ["task_create", "email_reply"]);

    const today = new Date().toISOString();
    const sys = `Tu es un assistant qui analyse un email pour créer une tâche actionnable.
Date de référence : ${today}
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma exact :
{
  "title": "titre de tâche court et actionnable (verbe à l'infinitif, max 80 caractères)",
  "summary": "résumé du mail en 1-2 phrases",
  "comments": "notes utiles pour l'exécution (contexte, contraintes, personnes, max 400 caractères)",
  "priority": "low | medium | high | urgent",
  "due_date": "ISO8601 ou null si aucune échéance détectée",
  "has_event": true|false,
  "event_start": "ISO8601 ou null",
  "event_end": "ISO8601 ou null",
  "event_title": "titre de l'événement ou null"
}
Détecte une date/heure de réunion explicite pour has_event=true.${userPromptsBlock}`;

    const user = `Sujet : ${data.subject ?? ""}
De : ${data.from ?? ""}
Reçu le : ${data.receivedAt ?? ""}

Corps :
${(data.body ?? "").slice(0, 4000)}`;

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
    const safe = ResultSchema.parse({
      title: (parsed as { title?: string }).title ?? data.subject ?? "Nouvelle tâche",
      summary: (parsed as { summary?: string }).summary ?? "",
      comments: (parsed as { comments?: string }).comments ?? "",
      priority: ((parsed as { priority?: string }).priority as "low" | "medium" | "high" | "urgent") ?? "medium",
      due_date: (parsed as { due_date?: string | null }).due_date ?? null,
      has_event: Boolean((parsed as { has_event?: boolean }).has_event),
      event_start: (parsed as { event_start?: string | null }).event_start ?? null,
      event_end: (parsed as { event_end?: string | null }).event_end ?? null,
      event_title: (parsed as { event_title?: string | null }).event_title ?? null,
    });
    return safe;
  });
