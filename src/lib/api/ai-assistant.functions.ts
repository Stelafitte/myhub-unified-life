import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  prompt: z.string().min(2).max(2000),
  contextRoute: z.string().nullable().optional(),
  forceEntity: z.enum(["emails", "contacts", "tasks", "events", "meetings", "documents", "auto"]).optional().nullable(),
});

const EntityEnum = z.enum(["emails", "contacts", "tasks", "events", "meetings", "documents"]);
type Entity = z.infer<typeof EntityEnum>;

const CriteriaSchema = z.object({
  entity: z.enum(["emails", "contacts", "tasks", "events", "meetings", "documents", "auto"]).default("auto"),
  keywords: z.array(z.string()).default([]),
  from_contains: z.array(z.string()).default([]),
  subject_contains: z.array(z.string()).default([]),
  body_contains: z.array(z.string()).default([]),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  unread_only: z.boolean().default(false),
  status: z.string().nullable().default(null),
  limit: z.number().min(1).max(100).default(30),
  user_intent: z.string().default(""),
});

export type EntityKind = "email" | "contact" | "task" | "event" | "meeting" | "document";

export type AnyMatch = {
  id: string;
  kind: EntityKind;
  title: string;
  subtitle: string | null;
  snippet: string;
  date: string | null;
  badge: string | null;
  /** kept for emails for back-compat with Phase 2 action proposals */
  raw?: Record<string, any>;
};

/** Back-compat: emails-only shape used by ActionCard / Phase 2 */
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
  entity: Entity;
  matches: AnyMatch[];
  /** Emails-only legacy view kept for Phase 2 action proposals */
  emailMatches: AiAssistantMatch[];
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

function clean(s: string) {
  return s.replace(/[,()%]/g, "").trim();
}

export const aiAssistantQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AiAssistantResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const today = new Date().toISOString();
    const sys = `Tu transformes une demande utilisateur en critères de recherche structurés sur la plateforme MyHub Pro.
Date de référence : ${today}
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma exact :
{
  "entity": "emails" | "contacts" | "tasks" | "events" | "meetings" | "documents" | "auto",
  "keywords": ["mots-clés généraux"],
  "from_contains": ["fragments d'expéditeur (emails uniquement)"],
  "subject_contains": ["fragments de sujet/titre"],
  "body_contains": ["fragments dans le corps/description/notes"],
  "date_from": "ISO8601 ou null",
  "date_to": "ISO8601 ou null",
  "unread_only": true|false,
  "status": "todo|in_progress|done|null (tâches)",
  "limit": 30,
  "user_intent": "résumé en 1 phrase"
}
Règles de choix d'entité :
- "mail", "email", "courriel", "expéditeur" -> emails
- "contact", "personne", "téléphone", "adresse" -> contacts
- "tâche", "todo", "à faire", "priorité" -> tasks
- "événement", "agenda", "calendrier" -> events
- "réunion", "rendez-vous", "rdv", "meeting" -> meetings
- "document", "fichier", "pj", "pièce jointe" -> documents
- Sinon, choisis l'entité la plus probable, jamais "auto" dans la réponse finale.`;

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

    let entity: Entity = (parsed.entity === "auto" ? "emails" : parsed.entity) as Entity;
    if (data.forceEntity && data.forceEntity !== "auto") entity = data.forceEntity as Entity;

    const matches: AnyMatch[] = [];
    const emailMatches: AiAssistantMatch[] = [];
    let warning: string | null = null;

    const allFragments = [...parsed.keywords, ...parsed.subject_contains, ...parsed.body_contains].map(clean).filter(Boolean);

    try {
      if (entity === "emails") {
        let q = supabase
          .from("emails")
          .select("id,subject,from_address,from_name,received_at,is_read,ai_category,body_text")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("received_at", { ascending: false })
          .limit(parsed.limit);

        const orParts: string[] = [];
        for (const f of parsed.from_contains.map(clean).filter(Boolean)) {
          orParts.push(`from_address.ilike.%${f}%`);
          orParts.push(`from_name.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        if (parsed.unread_only) q = q.eq("is_read", false);
        if (parsed.date_from) q = q.gte("received_at", parsed.date_from);
        if (parsed.date_to) q = q.lte("received_at", parsed.date_to);
        for (const s of parsed.subject_contains.map(clean).filter(Boolean)) q = q.ilike("subject", `%${s}%`);
        if (parsed.body_contains.length > 0) {
          const b = clean(parsed.body_contains[0]);
          if (b) q = q.ilike("body_text", `%${b}%`);
        }
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          const snippet = ((r as any).body_text ?? "").slice(0, 240);
          emailMatches.push({
            id: r.id, subject: r.subject, from_address: r.from_address, from_name: r.from_name,
            received_at: r.received_at, is_read: !!r.is_read, ai_category: r.ai_category ?? null, snippet,
          });
          matches.push({
            id: r.id, kind: "email",
            title: r.subject ?? "(sans objet)",
            subtitle: r.from_name ?? r.from_address ?? null,
            snippet, date: r.received_at, badge: r.ai_category ?? null,
            raw: r,
          });
        }
      } else if (entity === "contacts") {
        let q = supabase
          .from("contacts")
          .select("id,first_name,last_name,email,phone,organization,role,notes,updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(parsed.limit);
        const orParts: string[] = [];
        for (const f of allFragments) {
          orParts.push(`first_name.ilike.%${f}%`);
          orParts.push(`last_name.ilike.%${f}%`);
          orParts.push(`organization.ilike.%${f}%`);
          orParts.push(`role.ilike.%${f}%`);
          orParts.push(`notes.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || (r.email?.[0] ?? "(contact)");
          matches.push({
            id: r.id, kind: "contact",
            title: name,
            subtitle: r.organization ?? r.role ?? null,
            snippet: [r.email?.join(", "), r.phone?.join(", "), r.notes].filter(Boolean).join(" · ").slice(0, 240),
            date: r.updated_at, badge: r.role ?? null,
          });
        }
      } else if (entity === "tasks") {
        let q = supabase
          .from("tasks")
          .select("id,title,description,priority,status,due_date,updated_at,tags")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(parsed.limit);
        const orParts: string[] = [];
        for (const f of allFragments) {
          orParts.push(`title.ilike.%${f}%`);
          orParts.push(`description.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        if (parsed.status && ["todo", "in_progress", "done"].includes(parsed.status)) q = q.eq("status", parsed.status as any);
        if (parsed.date_from) q = q.gte("due_date", parsed.date_from);
        if (parsed.date_to) q = q.lte("due_date", parsed.date_to);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          matches.push({
            id: r.id, kind: "task",
            title: r.title ?? "(tâche)",
            subtitle: r.status ?? null,
            snippet: (r.description ?? "").slice(0, 240),
            date: r.due_date ?? r.updated_at, badge: r.priority ?? null,
          });
        }
      } else if (entity === "events") {
        let q = supabase
          .from("calendar_events")
          .select("id,title,description,start_at,end_at,location,category")
          .eq("user_id", userId)
          .order("start_at", { ascending: false })
          .limit(parsed.limit);
        const orParts: string[] = [];
        for (const f of allFragments) {
          orParts.push(`title.ilike.%${f}%`);
          orParts.push(`description.ilike.%${f}%`);
          orParts.push(`location.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        if (parsed.date_from) q = q.gte("start_at", parsed.date_from);
        if (parsed.date_to) q = q.lte("start_at", parsed.date_to);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          matches.push({
            id: r.id, kind: "event",
            title: r.title ?? "(événement)",
            subtitle: r.location ?? null,
            snippet: (r.description ?? "").slice(0, 240),
            date: r.start_at, badge: r.category ?? null,
          });
        }
      } else if (entity === "meetings") {
        let q = supabase
          .from("meetings")
          .select("id,title,description,start_at,end_at,location,status,is_online")
          .eq("user_id", userId)
          .order("start_at", { ascending: false })
          .limit(parsed.limit);
        const orParts: string[] = [];
        for (const f of allFragments) {
          orParts.push(`title.ilike.%${f}%`);
          orParts.push(`description.ilike.%${f}%`);
          orParts.push(`location.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        if (parsed.date_from) q = q.gte("start_at", parsed.date_from);
        if (parsed.date_to) q = q.lte("start_at", parsed.date_to);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          matches.push({
            id: r.id, kind: "meeting",
            title: r.title ?? "(réunion)",
            subtitle: r.is_online ? "En ligne" : (r.location ?? null),
            snippet: (r.description ?? "").slice(0, 240),
            date: r.start_at, badge: r.status ?? null,
          });
        }
      } else if (entity === "documents") {
        let q = supabase
          .from("documents")
          .select("id,filename,original_filename,description,ai_category,ai_summary,mime_type,created_at,source_type")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(parsed.limit);
        const orParts: string[] = [];
        for (const f of allFragments) {
          orParts.push(`filename.ilike.%${f}%`);
          orParts.push(`original_filename.ilike.%${f}%`);
          orParts.push(`description.ilike.%${f}%`);
          orParts.push(`ai_summary.ilike.%${f}%`);
        }
        if (orParts.length > 0) q = q.or(orParts.join(","));
        if (parsed.date_from) q = q.gte("created_at", parsed.date_from);
        if (parsed.date_to) q = q.lte("created_at", parsed.date_to);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          matches.push({
            id: r.id, kind: "document",
            title: r.original_filename ?? r.filename ?? "(document)",
            subtitle: r.mime_type ?? r.source_type ?? null,
            snippet: (r.ai_summary ?? r.description ?? "").slice(0, 240),
            date: r.created_at, badge: r.ai_category ?? null,
          });
        }
      }
    } catch (e: any) {
      warning = e?.message ?? "Erreur de recherche";
    }

    // Summary
    let summary = "";
    if (matches.length === 0) {
      summary = `Aucun résultat (${entity}) pour votre demande. Affinez les critères ou élargissez la période.`;
    } else {
      const sample = matches.slice(0, 15).map((m, i) => {
        const d = m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "";
        return `${i + 1}. [${d}] ${m.title}${m.subtitle ? " — " + m.subtitle : ""}\n   ${m.snippet.slice(0, 160)}`;
      }).join("\n");
      try {
        const sumResp = await callGateway(key, {
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: `Tu résumes une liste de résultats (${entity}) pour répondre à une demande utilisateur. Réponds en français, 2 à 4 phrases courtes, factuel. Pas de proposition d'actions.` },
            { role: "user", content: `Demande : ${data.prompt}\n\nRésultats (${matches.length}) :\n${sample}` },
          ],
        });
        summary = sumResp?.choices?.[0]?.message?.content ?? `${matches.length} résultat(s) trouvé(s).`;
      } catch (e: any) {
        summary = `${matches.length} résultat(s) trouvé(s).`;
        warning = warning ?? e?.message ?? null;
      }
    }

    return { summary, criteria: parsed, entity, matches, emailMatches, warning };
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

async function aiJson(key: string, schema: z.ZodTypeAny, sys: string, user: string, fallback: any): Promise<any> {
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
