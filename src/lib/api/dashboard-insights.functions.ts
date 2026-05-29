import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  unreadCount: z.number(),
  urgentEmailSubjects: z.array(z.string()).max(10),
  tasksDueSoon: z.array(
    z.object({ title: z.string(), due_date: z.string().nullable() })
  ).max(20),
  overdueCount: z.number(),
  todayEvents: z.number(),
});

const Result = z.object({
  summary: z.string(),
  suggestions: z.array(z.string()).max(5),
  alerts: z.array(z.string()).max(5),
});

export const generateDashboardInsights = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const sys = `Tu es un assistant qui produit un résumé quotidien concis et professionnel pour un dashboard.
Réponds UNIQUEMENT en JSON valide :
{
  "summary": "1 phrase synthétique (max 140 caractères) sur l'état des mails et tâches",
  "suggestions": ["3 max, actions concrètes (max 90 car. chacune)"],
  "alerts": ["3 max, échéances proches ou points critiques (max 90 car. chacune)"]
}
Ton: concis, factuel, jamais verbeux.`;

    const user = `Mails non lus: ${data.unreadCount}
Mails urgents (sujets): ${data.urgentEmailSubjects.slice(0, 5).join(" | ") || "aucun"}
Tâches à échéance proche: ${data.tasksDueSoon.slice(0, 10).map(t => `${t.title}${t.due_date ? ` (${t.due_date})` : ""}`).join(" | ") || "aucune"}
Tâches en retard: ${data.overdueCount}
Événements aujourd'hui: ${data.todayEvents}`;

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
    if (!resp.ok) throw new Error(`AI gateway: ${resp.status}`);
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    return Result.parse({
      summary: (parsed as any).summary ?? "Aucune donnée à analyser.",
      suggestions: Array.isArray((parsed as any).suggestions) ? (parsed as any).suggestions.slice(0, 5) : [],
      alerts: Array.isArray((parsed as any).alerts) ? (parsed as any).alerts.slice(0, 5) : [],
    });
  });
