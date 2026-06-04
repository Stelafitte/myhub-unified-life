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

// ============================================================================
// Phase 2 — Proposition d'actions éditables
// ============================================================================

const ProposeInput = z.object({
  prompt: z.string().min(1).max(2000),
  action: z.enum([
    "reply_email",
    "forward_email",
    "create_task",
    "create_event",
    "create_meeting",
    "create_contact",
    "save_document",
  ]),
  matchIds: z.array(z.string().uuid()).max(50).default([]),
  extra: z.string().max(2000).optional().nullable(),
  forwardTo: z.string().max(500).optional().nullable(),
});

const ReplyDraftSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
});
const TaskDraftSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  due_date: z.string().nullable().default(null),
});
const EventDraftSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  start_at: z.string().nullable().default(null),
  end_at: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  category: z.enum(["pro", "perso"]).default("pro"),
});
const MeetingDraftSchema = EventDraftSchema.extend({
  is_online: z.boolean().default(true),
  participants: z.array(z.object({ name: z.string().default(""), email: z.string().default("") })).default([]),
});
const ContactDraftSchema = z.object({
  first_name: z.string().default(""),
  last_name: z.string().default(""),
  email: z.array(z.string()).default([]),
  phone: z.array(z.string()).default([]),
  organization: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});
const DocumentDraftSchema = z.object({
  filename: z.string().default("note.txt"),
  description: z.string().default(""),
  content: z.string().default(""),
});

export type ProposedAction =
  | { id: string; kind: "reply_email"; emailId: string; account_id: string; to: string; in_reply_to: string | null; references: string | null; meta: { from: string; receivedAt: string | null }; draft: z.infer<typeof ReplyDraftSchema> }
  | { id: string; kind: "forward_email"; emailId: string; account_id: string; to: string; meta: { from: string; originalSubject: string }; draft: z.infer<typeof ReplyDraftSchema> }
  | { id: string; kind: "create_task"; sourceEmailId: string | null; draft: z.infer<typeof TaskDraftSchema> }
  | { id: string; kind: "create_event"; draft: z.infer<typeof EventDraftSchema> }
  | { id: string; kind: "create_meeting"; draft: z.infer<typeof MeetingDraftSchema> }
  | { id: string; kind: "create_contact"; draft: z.infer<typeof ContactDraftSchema> }
  | { id: string; kind: "save_document"; sourceEmailId: string | null; draft: z.infer<typeof DocumentDraftSchema> };

export type ProposeResult = { actions: ProposedAction[]; warning: string | null };

async function aiJson<T>(key: string, schema: z.ZodType<T>, sys: string, user: string, fallback: T): Promise<T> {
  try {
    const resp = await callGateway(key, {
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    });
    const raw = resp?.choices?.[0]?.message?.content ?? "{}";
    return schema.parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export const aiProposeActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProposeInput.parse(d))
  .handler(async ({ data, context }): Promise<ProposeResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const actions: ProposedAction[] = [];
    let warning: string | null = null;

    // Fetch emails when relevant
    const needsEmails = ["reply_email", "forward_email"].includes(data.action) ||
      (data.matchIds.length > 0 && ["create_task", "save_document"].includes(data.action));

    let emails: any[] = [];
    if (needsEmails && data.matchIds.length > 0) {
      const { data: rows, error } = await supabase
        .from("emails")
        .select("id,account_id,subject,from_address,from_name,to_address,received_at,message_id,body_text")
        .eq("user_id", userId)
        .in("id", data.matchIds);
      if (error) throw new Error(error.message);
      emails = rows ?? [];
    }

    if (data.action === "reply_email") {
      for (const e of emails) {
        const sys = `Tu rédiges en français une réponse professionnelle à un email. Réponds UNIQUEMENT en JSON {"subject":"Re: ...","body":"..."}. Le corps doit être court, factuel, sans signature (ajoutée auto). Termine par "Cordialement,".`;
        const usr = `Demande de l'utilisateur : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}\n\nMail à traiter :\nDe : ${e.from_name ?? ""} <${e.from_address ?? ""}>\nObjet : ${e.subject ?? ""}\n\n${(e.body_text ?? "").slice(0, 4000)}`;
        const draft = await aiJson(key, ReplyDraftSchema, sys, usr, { subject: `Re: ${e.subject ?? ""}`, body: "" });
        if (!draft.subject) draft.subject = `Re: ${e.subject ?? ""}`;
        actions.push({
          id: crypto.randomUUID(),
          kind: "reply_email",
          emailId: e.id,
          account_id: e.account_id,
          to: e.from_address ?? "",
          in_reply_to: e.message_id ?? null,
          references: e.message_id ?? null,
          meta: { from: e.from_name ?? e.from_address ?? "", receivedAt: e.received_at },
          draft,
        });
      }
    } else if (data.action === "forward_email") {
      for (const e of emails) {
        const sys = `Tu rédiges en français un court message d'introduction pour transférer un email. Réponds UNIQUEMENT en JSON {"subject":"Fwd: ...","body":"..."}.`;
        const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}\n\nMail à transférer :\nDe : ${e.from_name ?? ""} <${e.from_address ?? ""}>\nObjet : ${e.subject ?? ""}\n\n${(e.body_text ?? "").slice(0, 2000)}`;
        const draft = await aiJson(key, ReplyDraftSchema, sys, usr, { subject: `Fwd: ${e.subject ?? ""}`, body: "" });
        // Append original content quote
        const quoted = `\n\n---------- Message transféré ----------\nDe : ${e.from_name ?? ""} <${e.from_address ?? ""}>\nObjet : ${e.subject ?? ""}\n\n${(e.body_text ?? "").slice(0, 8000)}`;
        draft.body = (draft.body ?? "") + quoted;
        if (!draft.subject) draft.subject = `Fwd: ${e.subject ?? ""}`;
        actions.push({
          id: crypto.randomUUID(),
          kind: "forward_email",
          emailId: e.id,
          account_id: e.account_id,
          to: data.forwardTo ?? "",
          meta: { from: e.from_name ?? e.from_address ?? "", originalSubject: e.subject ?? "" },
          draft,
        });
      }
    } else if (data.action === "create_task") {
      const sources = emails.length > 0 ? emails : [null];
      for (const e of sources) {
        const sys = `Tu crées une tâche à faire. Réponds UNIQUEMENT en JSON {"title":"...","description":"...","priority":"low|medium|high","due_date":"ISO8601 ou null"}. Titre court (< 80 car).`;
        const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (e ? `\n\nÀ partir du mail :\nDe : ${e.from_name ?? ""}\nObjet : ${e.subject ?? ""}\n${(e.body_text ?? "").slice(0, 2000)}` : "");
        const draft = await aiJson(key, TaskDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", priority: "medium", due_date: null });
        actions.push({ id: crypto.randomUUID(), kind: "create_task", sourceEmailId: e?.id ?? null, draft });
      }
    } else if (data.action === "create_event" || data.action === "create_meeting") {
      const sys = `Tu crées un ${data.action === "create_meeting" ? "rendez-vous (réunion)" : "événement de calendrier"}. Date de référence : ${new Date().toISOString()}.
Réponds UNIQUEMENT en JSON ${data.action === "create_meeting"
  ? '{"title":"...","description":"...","start_at":"ISO8601","end_at":"ISO8601","location":null,"category":"pro","is_online":true,"participants":[{"name":"","email":""}]}'
  : '{"title":"...","description":"...","start_at":"ISO8601","end_at":"ISO8601","location":null,"category":"pro"}'}. Durée par défaut 30 min, heures ouvrées.`;
      const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}`;
      if (data.action === "create_meeting") {
        const draft = await aiJson(key, MeetingDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", start_at: null, end_at: null, location: null, category: "pro", is_online: true, participants: [] });
        actions.push({ id: crypto.randomUUID(), kind: "create_meeting", draft });
      } else {
        const draft = await aiJson(key, EventDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", start_at: null, end_at: null, location: null, category: "pro" });
        actions.push({ id: crypto.randomUUID(), kind: "create_event", draft });
      }
    } else if (data.action === "create_contact") {
      const sys = `Tu crées une fiche contact. Réponds UNIQUEMENT en JSON {"first_name":"","last_name":"","email":[],"phone":[],"organization":null,"role":null,"notes":null}.`;
      const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (emails[0] ? `\n\nMail source :\nDe : ${emails[0].from_name ?? ""} <${emails[0].from_address ?? ""}>\nObjet : ${emails[0].subject ?? ""}\n${(emails[0].body_text ?? "").slice(0, 2000)}` : "");
      const draft = await aiJson(key, ContactDraftSchema, sys, usr, { first_name: "", last_name: "", email: [], phone: [], organization: null, role: null, notes: null });
      actions.push({ id: crypto.randomUUID(), kind: "create_contact", draft });
    } else if (data.action === "save_document") {
      const sources = emails.length > 0 ? emails : [null];
      for (const e of sources) {
        const sys = `Tu génères une note textuelle à archiver. Réponds UNIQUEMENT en JSON {"filename":"nom.txt","description":"...","content":"texte"}. Filename court avec extension .txt ou .md.`;
        const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (e ? `\n\nSource (mail) :\nDe : ${e.from_name ?? ""}\nObjet : ${e.subject ?? ""}\n${(e.body_text ?? "").slice(0, 6000)}` : "");
        const draft = await aiJson(key, DocumentDraftSchema, sys, usr, { filename: "note.txt", description: data.prompt.slice(0, 200), content: "" });
        actions.push({ id: crypto.randomUUID(), kind: "save_document", sourceEmailId: e?.id ?? null, draft });
      }
    }

    return { actions, warning };
  });
