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
  entities: z.array(EntityEnum).default([]),
  keywords: z.array(z.string()).default([]),
  from_contains: z.array(z.string()).default([]),
  subject_contains: z.array(z.string()).default([]),
  body_contains: z.array(z.string()).default([]),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  unread_only: z.boolean().default(false),
  status: z.string().nullable().default(null),
  category: z.enum(["perso", "pro"]).nullable().default(null),
  limit: z.number().min(1).max(100).default(40),
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
  activePrompts: { title: string; target: string }[];
};

async function loadActivePrompts(
  supabase: any,
  userId: string,
  targets: string[],
): Promise<{ title: string; target: string; content: string }[]> {
  try {
    const { data } = await supabase
      .from("ai_prompts")
      .select("title,target,content")
      .eq("user_id", userId)
      .eq("is_active", true)
      .in("target", targets);
    return (data ?? []).filter((p: any) => (p.content ?? "").trim().length > 0);
  } catch {
    return [];
  }
}

function buildPromptBlock(prompts: { title: string; target: string; content: string }[]): string {
  if (prompts.length === 0) return "";
  const lines = prompts.map((p) => `# ${p.title} (${p.target})\n${p.content.trim()}`);
  return `\n\n--- Instructions personnalisées de l'utilisateur (à respecter en priorité) ---\n${lines.join("\n\n")}\n--- Fin des instructions personnalisées ---`;
}

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

// ─────────────────────────── Helpers de recherche par entité ───────────────────────────

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function orClause(fields: string[], fragments: string[]): string {
  const parts: string[] = [];
  for (const fr of fragments) {
    for (const f of fields) parts.push(`${f}.ilike.%${fr}%`);
  }
  return parts.join(",");
}

async function searchEmails(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains].map(clean).filter(Boolean)).slice(0, 8);
  const fromFrags = uniq(c.from_contains.map(clean).filter(Boolean)).slice(0, 6);
  let q = supabase
    .from("emails")
    .select("id,subject,from_address,from_name,received_at,is_read,ai_category,body_text")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(Math.max(c.limit, 60));
  const orParts: string[] = [];
  if (fromFrags.length > 0) orParts.push(orClause(["from_address", "from_name"], fromFrags));
  if (frags.length > 0) orParts.push(orClause(["subject", "body_text", "from_name", "from_address"], frags));
  const orStr = orParts.filter(Boolean).join(",");
  if (orStr) q = q.or(orStr);
  if (c.unread_only) q = q.eq("is_read", false);
  if (c.date_from) q = q.gte("received_at", c.date_from);
  if (c.date_to) q = q.lte("received_at", c.date_to);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => ({
    id: r.id, kind: "email" as const,
    title: r.subject ?? "(sans objet)",
    subtitle: r.from_name ?? r.from_address ?? null,
    snippet: (r.body_text ?? "").slice(0, 280),
    date: r.received_at, badge: r.ai_category ?? null,
    raw: r,
  }));
}

async function searchContacts(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains, ...c.from_contains].map(clean).filter(Boolean)).slice(0, 8);
  let q = supabase
    .from("contacts")
    .select("id,first_name,last_name,email,phone,organization,role,notes,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(c.limit, 60));
  if (frags.length > 0) q = q.or(orClause(["first_name", "last_name", "organization", "role", "notes"], frags));
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || (r.email?.[0] ?? "(contact)");
    return {
      id: r.id, kind: "contact" as const,
      title: name,
      subtitle: r.organization ?? r.role ?? null,
      snippet: [r.email?.join(", "), r.phone?.join(", "), r.notes].filter(Boolean).join(" · ").slice(0, 280),
      date: r.updated_at, badge: r.role ?? null,
    };
  });
}

async function searchTasks(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains].map(clean).filter(Boolean)).slice(0, 8);
  let q = supabase
    .from("tasks")
    .select("id,title,description,priority,status,due_date,updated_at,tags")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(c.limit, 60));
  if (frags.length > 0) q = q.or(orClause(["title", "description"], frags));
  if (c.status && ["todo", "in_progress", "done"].includes(c.status)) q = q.eq("status", c.status as any);
  if (c.date_from) q = q.gte("due_date", c.date_from);
  if (c.date_to) q = q.lte("due_date", c.date_to);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => ({
    id: r.id, kind: "task" as const,
    title: r.title ?? "(tâche)",
    subtitle: r.status ?? null,
    snippet: (r.description ?? "").slice(0, 280),
    date: r.due_date ?? r.updated_at, badge: r.priority ?? null,
  }));
}

async function searchEvents(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains].map(clean).filter(Boolean)).slice(0, 12);
  let q = supabase
    .from("calendar_events")
    .select("id,title,description,start_at,end_at,location,category")
    .eq("user_id", userId)
    .order("start_at", { ascending: false })
    .limit(Math.max(c.limit, 80));
  if (frags.length > 0) q = q.or(orClause(["title", "description", "location"], frags));
  if (c.category) q = q.eq("category", c.category);
  if (c.date_from) q = q.gte("start_at", c.date_from);
  if (c.date_to) q = q.lte("start_at", c.date_to);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => ({
    id: r.id, kind: "event" as const,
    title: r.title ?? "(événement)",
    subtitle: r.location ?? null,
    snippet: (r.description ?? "").slice(0, 280),
    date: r.start_at, badge: r.category ?? null,
  }));
}

async function searchMeetings(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains].map(clean).filter(Boolean)).slice(0, 8);
  let q = supabase
    .from("meetings")
    .select("id,title,description,start_at,end_at,location,status,is_online")
    .eq("user_id", userId)
    .order("start_at", { ascending: false })
    .limit(Math.max(c.limit, 60));
  if (frags.length > 0) q = q.or(orClause(["title", "description", "location"], frags));
  if (c.date_from) q = q.gte("start_at", c.date_from);
  if (c.date_to) q = q.lte("start_at", c.date_to);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => ({
    id: r.id, kind: "meeting" as const,
    title: r.title ?? "(réunion)",
    subtitle: r.is_online ? "En ligne" : (r.location ?? null),
    snippet: (r.description ?? "").slice(0, 280),
    date: r.start_at, badge: r.status ?? null,
  }));
}

async function searchDocuments(supabase: any, userId: string, c: z.infer<typeof CriteriaSchema>): Promise<AnyMatch[]> {
  const frags = uniq([...c.keywords, ...c.subject_contains, ...c.body_contains].map(clean).filter(Boolean)).slice(0, 8);
  let q = supabase
    .from("documents")
    .select("id,filename,original_filename,description,ai_category,ai_summary,mime_type,created_at,source_type")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(c.limit, 60));
  if (frags.length > 0) q = q.or(orClause(["filename", "original_filename", "description", "ai_summary"], frags));
  if (c.date_from) q = q.gte("created_at", c.date_from);
  if (c.date_to) q = q.lte("created_at", c.date_to);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r: any) => ({
    id: r.id, kind: "document" as const,
    title: r.original_filename ?? r.filename ?? "(document)",
    subtitle: r.mime_type ?? r.source_type ?? null,
    snippet: (r.ai_summary ?? r.description ?? "").slice(0, 280),
    date: r.created_at, badge: r.ai_category ?? null,
  }));
}

const RerankSchema = z.object({
  keep_ids: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
});

async function rerankWithAi(key: string, prompt: string, candidates: AnyMatch[], targetLimit: number): Promise<AnyMatch[]> {
  if (candidates.length <= 5) return candidates;
  const list = candidates.slice(0, 80).map((m, i) => {
    const d = m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "";
    return `${i + 1}. [${m.kind}|${m.id}] ${d} ${m.title}${m.subtitle ? " — " + m.subtitle : ""} ${m.snippet ? "→ " + m.snippet.slice(0, 140) : ""}`;
  }).join("\n");
  try {
    const resp = await callGateway(key, {
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `Tu filtres une liste de résultats pour ne garder que ceux RÉELLEMENT pertinents pour la demande utilisateur. Réponds UNIQUEMENT en JSON {"keep_ids":["id1","id2",...],"reasoning":"..."}. Garde max ${targetLimit} ids. Sois strict : exclus tout ce qui n'a pas de rapport clair avec la demande (même si un mot-clé matche par hasard). Conserve l'ordre de pertinence (le plus pertinent en premier).`,
        },
        {
          role: "user",
          content: `Demande utilisateur :\n"""${prompt}"""\n\nCandidats (entité|id puis date, titre, sous-titre, extrait) :\n${list}\n\nRends les ids à conserver, ordonnés par pertinence.`,
        },
      ],
      response_format: { type: "json_object" },
    });
    const raw = resp?.choices?.[0]?.message?.content ?? "{}";
    const parsed = RerankSchema.parse(JSON.parse(raw));
    const keep = new Set(parsed.keep_ids);
    if (keep.size === 0) return candidates.slice(0, targetLimit);
    const ordered = parsed.keep_ids
      .map((id) => candidates.find((c) => c.id === id))
      .filter(Boolean) as AnyMatch[];
    return ordered.slice(0, targetLimit);
  } catch {
    return candidates.slice(0, targetLimit);
  }
}

export const aiAssistantQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AiAssistantResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const today = new Date().toISOString();
    const generalPrompts = await loadActivePrompts(supabase, userId, ["general"]);
    const promptBlock = buildPromptBlock(generalPrompts);
    const sys = `Tu transformes une demande utilisateur en critères de recherche structurés sur la plateforme MyHub Pro.
Date de référence : ${today}
Tu DOIS répondre UNIQUEMENT en JSON valide avec ce schéma exact :
{
  "entities": ["emails"|"contacts"|"tasks"|"events"|"meetings"|"documents", ...],
  "keywords": ["mots-clés généraux et synonymes utiles"],
  "from_contains": ["fragments d'expéditeur (emails uniquement)"],
  "subject_contains": ["fragments précis de sujet/titre"],
  "body_contains": ["fragments précis dans le corps/description/notes"],
  "date_from": "ISO8601 ou null",
  "date_to": "ISO8601 ou null",
  "unread_only": true|false,
  "status": "todo|in_progress|done|null (tâches)",
  "category": "perso|pro|null (events uniquement)",
  "limit": 30,
  "user_intent": "résumé clair en 1 phrase"
}
RÈGLES IMPORTANTES :
- "entities" peut contenir PLUSIEURS valeurs si la demande est ambiguë ou trans-domaines.
- Mapping entités : mail/email/courriel/expéditeur → emails ; contact/personne/téléphone → contacts ; tâche/todo/à faire → tasks ; événement/agenda/rdv/rendez-vous → events (ET meetings si visio/réunion).
- CATÉGORIE : "perso"/"personnel"/"privé"/"perso non pro" → category="perso" ; "pro"/"professionnel"/"travail" → category="pro". Si la demande est générique (ex: "mes rdv perso", "tous mes événements personnels"), LAISSE keywords/subject_contains/body_contains VIDES — le filtre category seul ramène tous les événements de la catégorie. N'ajoute des mots-clés QUE si l'utilisateur cible un sujet précis (ex: "rdv kiné", "rdv chez le médecin").
- Synonymes médicaux/perso utiles si l'utilisateur évoque la santé : kiné, kinésithérapie, kinesi, renfo, balneo, balnéo, médecin, dentiste, ostéo, ostéopathe, RDV médical, consultation, infirmière, biologie, radio, IRM.
- Privilégie la PRÉCISION dans subject/body/from_contains et la LARGEUR dans keywords (synonymes, accents/sans accents).
- N'invente pas de dates : ne renseigne date_from/date_to QUE si l'utilisateur le précise.${promptBlock}`;

    const extracted = await callGateway(key, {
      model: "google/gemini-2.5-pro",
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

    // Détermine les entités à interroger
    let entities: Entity[] = parsed.entities.length > 0 ? parsed.entities : ["emails"];
    if (data.forceEntity && data.forceEntity !== "auto") entities = [data.forceEntity as Entity];
    entities = uniq(entities);

    let allMatches: AnyMatch[] = [];
    const emailMatches: AiAssistantMatch[] = [];
    let warning: string | null = null;

    const SEARCHERS: Record<Entity, (s: any, u: string, c: any) => Promise<AnyMatch[]>> = {
      emails: searchEmails, contacts: searchContacts, tasks: searchTasks,
      events: searchEvents, meetings: searchMeetings, documents: searchDocuments,
    };

    try {
      const results = await Promise.all(entities.map((e) => SEARCHERS[e](supabase, userId, parsed).catch((err) => {
        warning = err?.message ?? "Erreur de recherche";
        return [] as AnyMatch[];
      })));
      allMatches = results.flat();
    } catch (e: any) {
      warning = e?.message ?? "Erreur de recherche";
    }

    // Re-ranking IA : élimine les faux positifs des ilike
    if (allMatches.length > 5) {
      allMatches = await rerankWithAi(key, data.prompt, allMatches, parsed.limit);
    }

    // Back-compat : alimente emailMatches pour Phase 2
    for (const m of allMatches) {
      if (m.kind === "email" && m.raw) {
        emailMatches.push({
          id: m.id,
          subject: m.raw.subject ?? null,
          from_address: m.raw.from_address ?? null,
          from_name: m.raw.from_name ?? null,
          received_at: m.raw.received_at ?? null,
          snippet: (m.raw.body_text ?? "").slice(0, 240),
          is_read: !!m.raw.is_read,
          ai_category: m.raw.ai_category ?? null,
        });
      }
    }

    const entity: Entity = (allMatches[0]?.kind === "contact" ? "contacts"
      : allMatches[0]?.kind === "task" ? "tasks"
      : allMatches[0]?.kind === "event" ? "events"
      : allMatches[0]?.kind === "meeting" ? "meetings"
      : allMatches[0]?.kind === "document" ? "documents"
      : "emails") as Entity;

    // Résumé
    let summary = "";
    if (allMatches.length === 0) {
      summary = `Aucun résultat trouvé pour : "${parsed.user_intent || data.prompt}". Essayez de reformuler, d'élargir la période ou les mots-clés.`;
    } else {
      const sample = allMatches.slice(0, 15).map((m, i) => {
        const d = m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "";
        return `${i + 1}. [${m.kind}][${d}] ${m.title}${m.subtitle ? " — " + m.subtitle : ""}\n   ${m.snippet.slice(0, 160)}`;
      }).join("\n");
      try {
        const sumResp = await callGateway(key, {
          model: "google/gemini-3-flash-preview",
          max_tokens: 2000,
          messages: [
            { role: "system", content: `Tu résumes une liste de résultats issus de la recherche multi-entités MyHub Pro. Réponds en français, de manière complète mais concise (4 à 8 phrases au besoin). Mentionne les regroupements pertinents (expéditeur, sujet, période, type d'entité). Termine toujours par une phrase complète — ne tronque jamais ta réponse. Ne propose pas d'actions.${promptBlock}` },
            { role: "user", content: `Demande : ${data.prompt}\nIntention détectée : ${parsed.user_intent}\nEntités cherchées : ${entities.join(", ")}\n\nRésultats (${allMatches.length}) :\n${sample}` },
          ],
        });
        summary = sumResp?.choices?.[0]?.message?.content ?? `${allMatches.length} résultat(s) trouvé(s).`;
      } catch (e: any) {
        summary = `${allMatches.length} résultat(s) trouvé(s).`;
        warning = warning ?? e?.message ?? null;
      }
    }

    return {
      summary, criteria: parsed, entity, matches: allMatches, emailMatches, warning,
      activePrompts: generalPrompts.map((p) => ({ title: p.title, target: p.target })),
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

export type ProposeResult = { actions: ProposedAction[]; warning: string | null; activePrompts: { title: string; target: string }[] };

const ACTION_TARGETS: Record<string, string[]> = {
  reply_email: ["general", "email_reply"],
  forward_email: ["general", "email_reply"],
  create_task: ["general", "task_create"],
  create_event: ["general", "meeting"],
  create_meeting: ["general", "meeting"],
  create_contact: ["general"],
  save_document: ["general", "document"],
};

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

    const activePrompts = await loadActivePrompts(supabase, userId, ACTION_TARGETS[data.action] ?? ["general"]);
    const promptBlock = buildPromptBlock(activePrompts);

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
        const sys = `Tu rédiges en français une réponse professionnelle à un email. Réponds UNIQUEMENT en JSON {"subject":"Re: ...","body":"..."}. Le corps doit être court, factuel, sans signature (ajoutée auto). Termine par "Cordialement,".${promptBlock}`;
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
        const sys = `Tu rédiges en français un court message d'introduction pour transférer un email. Réponds UNIQUEMENT en JSON {"subject":"Fwd: ...","body":"..."}.${promptBlock}`;
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
        const sys = `Tu crées une tâche à faire. Réponds UNIQUEMENT en JSON {"title":"...","description":"...","priority":"low|medium|high","due_date":"ISO8601 ou null"}. Titre court (< 80 car).${promptBlock}`;
        const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (e ? `\n\nÀ partir du mail :\nDe : ${e.from_name ?? ""}\nObjet : ${e.subject ?? ""}\n${(e.body_text ?? "").slice(0, 2000)}` : "");
        const draft = await aiJson(key, TaskDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", priority: "medium", due_date: null });
        actions.push({ id: crypto.randomUUID(), kind: "create_task", sourceEmailId: e?.id ?? null, draft });
      }
    } else if (data.action === "create_event" || data.action === "create_meeting") {
      const sys = `Tu crées un ${data.action === "create_meeting" ? "rendez-vous (réunion)" : "événement de calendrier"}. Date de référence : ${new Date().toISOString()}.
Réponds UNIQUEMENT en JSON ${data.action === "create_meeting"
  ? '{"title":"...","description":"...","start_at":"ISO8601","end_at":"ISO8601","location":null,"category":"pro","is_online":true,"participants":[{"name":"","email":""}]}'
  : '{"title":"...","description":"...","start_at":"ISO8601","end_at":"ISO8601","location":null,"category":"pro"}'}. Durée par défaut 30 min, heures ouvrées.${promptBlock}`;
      const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}`;
      if (data.action === "create_meeting") {
        const draft = await aiJson(key, MeetingDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", start_at: null, end_at: null, location: null, category: "pro", is_online: true, participants: [] });
        actions.push({ id: crypto.randomUUID(), kind: "create_meeting", draft });
      } else {
        const draft = await aiJson(key, EventDraftSchema, sys, usr, { title: data.prompt.slice(0, 80), description: "", start_at: null, end_at: null, location: null, category: "pro" });
        actions.push({ id: crypto.randomUUID(), kind: "create_event", draft });
      }
    } else if (data.action === "create_contact") {
      const sys = `Tu crées une fiche contact. Réponds UNIQUEMENT en JSON {"first_name":"","last_name":"","email":[],"phone":[],"organization":null,"role":null,"notes":null}.${promptBlock}`;
      const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (emails[0] ? `\n\nMail source :\nDe : ${emails[0].from_name ?? ""} <${emails[0].from_address ?? ""}>\nObjet : ${emails[0].subject ?? ""}\n${(emails[0].body_text ?? "").slice(0, 2000)}` : "");
      const draft = await aiJson(key, ContactDraftSchema, sys, usr, { first_name: "", last_name: "", email: [], phone: [], organization: null, role: null, notes: null });
      actions.push({ id: crypto.randomUUID(), kind: "create_contact", draft });
    } else if (data.action === "save_document") {
      const sources = emails.length > 0 ? emails : [null];
      for (const e of sources) {
        const sys = `Tu génères une note textuelle à archiver. Réponds UNIQUEMENT en JSON {"filename":"nom.txt","description":"...","content":"texte"}. Filename court avec extension .txt ou .md.${promptBlock}`;
        const usr = `Demande : ${data.prompt}${data.extra ? "\nInstruction : " + data.extra : ""}` + (e ? `\n\nSource (mail) :\nDe : ${e.from_name ?? ""}\nObjet : ${e.subject ?? ""}\n${(e.body_text ?? "").slice(0, 6000)}` : "");
        const draft = await aiJson(key, DocumentDraftSchema, sys, usr, { filename: "note.txt", description: data.prompt.slice(0, 200), content: "" });
        actions.push({ id: crypto.randomUUID(), kind: "save_document", sourceEmailId: e?.id ?? null, draft });
      }
    }

    return { actions, warning, activePrompts: activePrompts.map((p) => ({ title: p.title, target: p.target })) };
  });

// ============================================================================
// Phase 3 — Chat conversationnel libre (sans recherche)
// ============================================================================

const ChatMsgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const ChatInput = z.object({
  messages: z.array(ChatMsgSchema).min(1).max(40),
  contextSummary: z.string().max(6000).optional().nullable(),
});

export type AiChatResult = { reply: string; activePrompts: { title: string; target: string }[] };

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatInput.parse(d))
  .handler(async ({ data, context }): Promise<AiChatResult> => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const generalPrompts = await loadActivePrompts(supabase, userId, ["general"]);
    const promptBlock = buildPromptBlock(generalPrompts);

    const sys = `Tu es l'assistant IA conversationnel de MyHub Pro. Tu réponds en français, de manière claire, utile et concise. Tu peux discuter librement avec l'utilisateur : répondre à ses questions, expliquer pourquoi une recherche a (ou n'a pas) abouti, donner des conseils, suggérer comment reformuler une demande, ou aider à apprendre/améliorer le système. Si l'utilisateur veut sauvegarder une instruction durable, dis-lui d'aller dans Réglages > IA > Prompts pour l'enregistrer comme prompt actif. Tu n'as PAS accès direct aux données : si l'utilisateur te demande de chercher des emails/événements/contacts, invite-le à utiliser le mode "Rechercher" (bouton 🔍 en haut du composer).${data.contextSummary ? "\n\nContexte de la dernière recherche :\n" + data.contextSummary : ""}${promptBlock}`;

    const resp = await callGateway(key, {
      model: "google/gemini-3-flash-preview",
      max_tokens: 2000,
      messages: [{ role: "system", content: sys }, ...data.messages],
    });
    const reply = resp?.choices?.[0]?.message?.content ?? "(pas de réponse)";
    return { reply, activePrompts: generalPrompts.map((p) => ({ title: p.title, target: p.target })) };
  });
