import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  text: z.string().min(1).max(500),
  kind: z.enum(["suggestion", "alert"]),
  context: z
    .object({
      unreadCount: z.number().optional(),
      overdueCount: z.number().optional(),
      todayEvents: z.number().optional(),
    })
    .optional(),
});

export type ProposedAction =
  | {
      type: "create_task";
      title: string;
      priority: "low" | "medium" | "high" | "urgent";
      due_in_hours: number | null;
      reason: string;
    }
  | {
      type: "create_event";
      title: string;
      start_iso: string;
      duration_min: number;
      reason: string;
    }
  | {
      type: "open_inbox";
      reason: string;
    }
  | {
      type: "open_tasks";
      reason: string;
    }
  | {
      type: "reminder";
      title: string;
      remind_in_hours: number;
      reason: string;
    }
  | {
      type: "none";
      reason: string;
    };

export const proposeInsightAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<ProposedAction> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const now = new Date().toISOString();
    const sys = `Tu transformes une suggestion ou alerte de dashboard en une action concrète. Réponds UNIQUEMENT en JSON valide selon UN de ces formats :
{"type":"create_task","title":"...","priority":"low|medium|high|urgent","due_in_hours": nombre|null,"reason":"..."}
{"type":"create_event","title":"...","start_iso":"ISO8601","duration_min":30,"reason":"..."}
{"type":"open_inbox","reason":"..."}
{"type":"open_tasks","reason":"..."}
{"type":"reminder","title":"...","remind_in_hours": nombre,"reason":"..."}
{"type":"none","reason":"..."}
Choisis le type le plus pertinent. "reason" = 1 phrase courte (max 120 car.) justifiant l'action. Date de référence: ${now}.`;

    const user = `Type: ${data.kind}
Texte: ${data.text}
Contexte: ${JSON.stringify(data.context ?? {})}`;

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
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.type === "string") return parsed as ProposedAction;
    } catch {
      /* ignore */
    }
    return { type: "none", reason: "Aucune action automatique pertinente." };
  });
