import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  unreadCount: z.number(),
  urgentEmails: z
    .array(z.object({ id: z.string(), subject: z.string(), from: z.string().nullable().optional() }))
    .max(10),
  tasksDueSoon: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        due_date: z.string().nullable(),
      }),
    )
    .max(20),
  overdueCount: z.number(),
  todayEvents: z.number(),
});

const Origin = z.object({
  type: z.enum(["email", "task", "calendar", "none"]),
  label: z.string().max(160).optional().nullable(),
  refId: z.string().optional().nullable(),
});

const InsightItem = z.object({
  text: z.string().max(160),
  origin: Origin,
});

const Result = z.object({
  summary: z.string(),
  suggestions: z.array(InsightItem).max(5),
  alerts: z.array(InsightItem).max(5),
});

export type InsightOrigin = z.infer<typeof Origin>;
export type DashboardInsightItem = z.infer<typeof InsightItem>;
export type DashboardInsights = z.infer<typeof Result>;

export const generateDashboardInsights = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<DashboardInsights> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const sys = `Tu produis un résumé quotidien concis pour un dashboard.
Réponds UNIQUEMENT en JSON valide :
{
  "summary": "1 phrase synthétique (max 140 car.) sur l'état des mails et tâches",
  "suggestions": [{ "text": "action concrète max 90 car.", "origin": { "type":"email|task|calendar|none", "label":"libellé court (ex: sujet du mail ou nom de tâche)", "refId":"id éventuel" } }],
  "alerts":      [{ "text": "échéance proche ou point critique max 90 car.", "origin": { "type":"email|task|calendar|none", "label":"...", "refId":"..." } }]
}
Règles:
- 3 max par liste, factuel, jamais verbeux.
- "origin.refId" DOIT correspondre EXACTEMENT à un id fourni dans le contexte si la suggestion/alerte porte sur cet élément. Sinon mets origin.type = "none".
- "origin.label" = sujet du mail / titre de la tâche correspondant.`;

    const user = `Mails non lus: ${data.unreadCount}
Mails urgents (id | sujet | expéditeur):
${data.urgentEmails.slice(0, 10).map((e) => `${e.id} | ${e.subject} | ${e.from ?? ""}`).join("\n") || "aucun"}
Tâches à échéance proche (id | titre | échéance):
${data.tasksDueSoon.slice(0, 10).map((t) => `${t.id} | ${t.title} | ${t.due_date ?? ""}`).join("\n") || "aucune"}
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
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const normalize = (arr: any): DashboardInsightItem[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .slice(0, 5)
        .map((it): DashboardInsightItem | null => {
          if (typeof it === "string") {
            return { text: it.slice(0, 160), origin: { type: "none" } };
          }
          if (it && typeof it.text === "string") {
            const o = it.origin ?? {};
            const type = ["email", "task", "calendar", "none"].includes(o.type)
              ? (o.type as InsightOrigin["type"])
              : "none";
            return {
              text: String(it.text).slice(0, 160),
              origin: {
                type,
                label: typeof o.label === "string" ? o.label.slice(0, 160) : null,
                refId: typeof o.refId === "string" ? o.refId : null,
              },
            };
          }
          return null;
        })
        .filter((x): x is DashboardInsightItem => x != null);
    };

    return Result.parse({
      summary: typeof parsed.summary === "string" ? parsed.summary : "Aucune donnée à analyser.",
      suggestions: normalize(parsed.suggestions),
      alerts: normalize(parsed.alerts),
    });
  });
