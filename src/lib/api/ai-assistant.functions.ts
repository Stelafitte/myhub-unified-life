import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  prompt: z.string().min(2).max(2000),
  contextRoute: z.string().nullable().optional(),
});

const CriteriaSchema = z.object({
  entity: z.enum(["emails", "contacts", "tasks", "events", "meetings", "documents", "auto"]).default("emails"),
  keywords: z.array(z.string()).default([]),
  from_contains: z.array(z.string()).default([]),
  subject_contains: z.array(z.string()).default([]),
  body_contains: z.array(z.string()).default([]),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  unread_only: z.boolean().default(false),
  limit: z.number().min(1).max(100).default(30),
  user_intent: z.string().default(""),
});

export type AiAssistantMatch = {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  received_at: string | null;
  snippet: string;
  is_read: boolean;
  ai_category: string | null;
};

export type AiAssistantResult = {
  summary: string;
  criteria: z.infer<typeof CriteriaSchema>;
  matches: AiAssistantMatch[];
  entity: string;
  warning: string | null;
};

async function callGateway(key: string, body: unknown) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) throw new Error("Limite IA atteinte, réessayez dans un instant.");
    if (resp.status === 402) throw new Error("Crédits IA épuisés. Ajoutez des crédits dans les réglages.");
    throw new Error(`Erreur IA (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export const aiAssistantQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AiAssistantResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const today = new Date().toISOString();
    const sys = `Tu es un assistant qui transforme une demande en langage naturel en critères de recherche structurés sur la plateforme MyHub Pro.
Date de référence : ${today}
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma exact :
{
  "entity": "emails" | "contacts" | "tasks" | "events" | "meetings" | "documents" | "auto",
  "keywords": ["mots-clés généraux"],
  "from_contains": ["fragments d'adresse ou de nom d'expéditeur"],
  "subject_contains": ["fragments de sujet"],
  "body_contains": ["fragments à chercher dans le corps"],
  "date_from": "ISO8601 ou null",
  "date_to": "ISO8601 ou null",
  "unread_only": true|false,
  "limit": 30,
  "user_intent": "résumé en 1 phrase de ce que l'utilisateur cherche/veut faire"
}
Pour la Phase 1, l'entité est presque toujours "emails". Si la demande mentionne explicitement un autre type, mets "auto".
Exemple "trouve les mails de Ternacle traitant d'IDEAL" -> from_contains:["ternacle"], body_contains:["IDEAL"], subject_contains:["IDEAL"].`;

    const extracted = await callGateway(key, {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: data.prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = extracted?.choices?.[0]?.message?.content ?? "{}";
    let parsed: z.infer<typeof CriteriaSchema>;
    try {
      parsed = CriteriaSchema.parse(JSON.parse(raw));
    } catch {
      parsed = CriteriaSchema.parse({});
    }

    // Phase 1: emails uniquement
    let query = supabase
      .from("emails")
      .select("id,subject,from_address,from_name,received_at,is_read,ai_category,body_text")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(parsed.limit);

    const orParts: string[] = [];
    for (const f of parsed.from_contains) {
      const safe = f.replace(/[,()]/g, "");
      orParts.push(`from_address.ilike.%${safe}%`);
      orParts.push(`from_name.ilike.%${safe}%`);
    }
    if (orParts.length > 0) query = query.or(orParts.join(","));

    if (parsed.unread_only) query = query.eq("is_read", false);
    if (parsed.date_from) query = query.gte("received_at", parsed.date_from);
    if (parsed.date_to) query = query.lte("received_at", parsed.date_to);

    // subject/body filters: AND each fragment via ilike
    for (const s of parsed.subject_contains) {
      query = query.ilike("subject", `%${s.replace(/[,()]/g, "")}%`);
    }
    // Only one body filter to keep it simple
    if (parsed.body_contains.length > 0) {
      const b = parsed.body_contains[0].replace(/[,()]/g, "");
      query = query.ilike("body_text", `%${b}%`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    let matches: AiAssistantMatch[] = (rows ?? []).map((r) => ({
      id: r.id,
      subject: r.subject,
      from_address: r.from_address,
      from_name: r.from_name,
      received_at: r.received_at,
      is_read: !!r.is_read,
      ai_category: r.ai_category ?? null,
      snippet: ((r as any).body_text ?? "").slice(0, 240),
    }));

    // Post-filter with remaining body_contains fragments (AND), client-side
    if (parsed.body_contains.length > 1) {
      const extras = parsed.body_contains.slice(1).map((s) => s.toLowerCase());
      matches = matches.filter((m) => {
        const txt = (m.snippet + " " + (m.subject ?? "")).toLowerCase();
        return extras.every((x) => txt.includes(x));
      });
    }

    // Summary via AI
    let summary = "";
    let warning: string | null = null;
    if (matches.length === 0) {
      summary = "Aucun mail ne correspond à votre demande. Affinez les critères ou élargissez la période.";
    } else {
      const sample = matches.slice(0, 15).map((m, i) => {
        const d = m.received_at ? new Date(m.received_at).toLocaleString("fr-FR") : "";
        return `${i + 1}. [${d}] ${m.from_name ?? m.from_address ?? ""} — ${m.subject ?? "(sans objet)"}\n   ${m.snippet.slice(0, 160)}`;
      }).join("\n");
      try {
        const sumResp = await callGateway(key, {
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `Tu résumes une liste de mails pour répondre à une demande utilisateur. Réponds en français, 2 à 4 phrases courtes, factuel. Ne propose pas d'actions, seulement le constat.`,
            },
            {
              role: "user",
              content: `Demande : ${data.prompt}\n\nMails trouvés (${matches.length}) :\n${sample}`,
            },
          ],
        });
        summary = sumResp?.choices?.[0]?.message?.content ?? `${matches.length} mail(s) trouvé(s).`;
      } catch (e: any) {
        summary = `${matches.length} mail(s) trouvé(s).`;
        warning = e?.message ?? null;
      }
    }

    return {
      summary,
      criteria: parsed,
      matches,
      entity: "emails",
      warning,
    };
  });
