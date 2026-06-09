import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EntityType = z.enum(["email", "task", "meeting", "document", "contact"]);
const GRAPH_VERSION = "v20.0";

function normalizePhone(value: string | null | undefined) {
  return (value ?? "").replace(/[^\d]/g, "");
}

async function sendSpaceMessageToWhatsapp({
  supabase,
  userId,
  spaceId,
  content,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  spaceId: string;
  content: string;
}) {
  const { data: space, error: spaceErr } = await supabase
    .from("collab_spaces")
    .select("id,name,whatsapp_phone_number,whatsapp_group_id,wa_group_name")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (spaceErr) throw new Error(spaceErr.message);

  const to = normalizePhone(space?.whatsapp_phone_number);
  if (!to) {
    const looksLikeWaSpace =
      !!space?.whatsapp_group_id ||
      !!space?.wa_group_name ||
      (space?.name ?? "").toLowerCase().startsWith("wa :");
    return {
      attempted: false,
      sent: false,
      reason: looksLikeWaSpace
        ? "Cet espace vient d’un export de groupe WhatsApp : l’envoi automatique est possible seulement vers un numéro individuel renseigné dans l’onglet WhatsApp."
        : null,
      wa_message_id: null,
    };
  }

  // Reject the demo placeholder explicitly
  if (to === "33612345678") {
    return {
      attempted: true,
      sent: false,
      reason:
        "Le numéro destinataire est encore l’exemple « +33 6 12 34 56 78 ». Remplacez-le par votre vrai numéro WhatsApp dans l’onglet WhatsApp puis enregistrez.",
      wa_message_id: null,
    };
  }

  // Prefer global secrets (always fresh), fallback to per-user stored connection
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const envPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  let accessToken: string | null = envToken ?? null;
  let phoneNumberId: string | null = envPhoneId ?? null;
  let connectionId: string | null = null;

  const { data: conn, error: connErr } = await supabase
    .from("wa_business_connections")
    .select("id,phone_number_id,access_token,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connErr) throw new Error(connErr.message);
  if (conn) {
    connectionId = conn.id;
    if (!accessToken) accessToken = conn.access_token;
    if (!phoneNumberId) phoneNumberId = conn.phone_number_id;
  }

  if (!accessToken || !phoneNumberId) {
    return {
      attempted: true,
      sent: false,
      reason:
        "Aucune connexion WhatsApp Business active (token ou phone_number_id manquant).",
      wa_message_id: null,
    };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: content },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const metaMsg = json?.error?.message ?? `HTTP ${res.status}`;
    const code = json?.error?.code;
    const sub = json?.error?.error_subcode;
    const hint =
      code === 190 || /authentication/i.test(metaMsg)
        ? " — Le token WhatsApp est invalide ou expiré. Régénérez WHATSAPP_ACCESS_TOKEN dans les secrets."
        : code === 131030 || code === 131026
          ? " — Le numéro destinataire n’a pas autorisé la réception (en mode test, ajoutez-le aux numéros autorisés dans Meta Business)."
          : "";
    return {
      attempted: true,
      sent: false,
      reason: `WhatsApp: ${metaMsg}${sub ? ` (sub ${sub})` : ""}${hint}`,
      wa_message_id: null,
    };
  }

  const waMessageId = json?.messages?.[0]?.id ?? `local-${crypto.randomUUID()}`;
  if (connectionId) {
    await supabase.from("wa_messages").insert({
      connection_id: connectionId,
      user_id: userId,
      space_id: spaceId,
      wa_message_id: waMessageId,
      from_number: to,
      is_from_me: true,
      type: "text",
      content,
      status: "sent",
      timestamp: new Date().toISOString(),
    });
  }

  return { attempted: true, sent: true, reason: null, wa_message_id: waMessageId };
}

/** Arborescence parent/enfant des espaces de l'utilisateur. */
export const getSpaceTree = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("collab_spaces")
      .select(
        "id,name,parent_id,level,icon,color,type,position,archived_at",
      )
      .is("archived_at", null)
      .order("level", { ascending: true })
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { spaces: data ?? [] };
  });

/** Crée un espace (racine ou enfant). */
export const createSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(160),
        parentId: z.string().uuid().nullable().optional(),
        icon: z.string().max(8).optional(),
        type: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let level = 0;
    if (data.parentId) {
      const { data: parent } = await supabase
        .from("collab_spaces")
        .select("level")
        .eq("id", data.parentId)
        .maybeSingle();
      level = (parent?.level ?? 0) + 1;
    }
    const { data: row, error } = await supabase
      .from("collab_spaces")
      .insert({
        user_id: userId,
        name: data.name,
        parent_id: data.parentId ?? null,
        level,
        icon: data.icon ?? null,
        type: data.type ?? "project",
      })
      .select("id,name,parent_id,level,icon")
      .single();
    if (error) throw new Error(error.message);
    return { space: row };
  });

/** Supprime un espace (et tous ses descendants en cascade via la FK). */
export const deleteSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ spaceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Récupère tous les descendants récursivement côté serveur
    const { data: all } = await supabase
      .from("collab_spaces")
      .select("id,parent_id")
      .eq("user_id", userId);
    const ids = new Set<string>([data.spaceId]);
    let added = true;
    while (added) {
      added = false;
      for (const s of all ?? []) {
        if (s.parent_id && ids.has(s.parent_id) && !ids.has(s.id)) {
          ids.add(s.id);
          added = true;
        }
      }
    }
    const { error } = await supabase
      .from("collab_spaces")
      .delete()
      .in("id", Array.from(ids))
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: ids.size };
  });

/** Renomme un espace. */
export const renameSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        name: z.string().min(1).max(160),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_spaces")
      .update({ name: data.name })
      .eq("id", data.spaceId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Messages chronologiques d'un espace. */
export const listSpaceMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ spaceId: z.string().uuid(), limit: z.number().min(1).max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("collab_messages")
      .select("id,content,type,sender_name,message_at,metadata,user_id")
      .eq("space_id", data.spaceId)
      .order("message_at", { ascending: true })
      .limit(data.limit ?? 200);
    if (error) throw new Error(error.message);
    return { messages: rows ?? [] };
  });

/** Poste un message texte (ou type) dans le chat. */
export const postSpaceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        content: z.string().min(1).max(8000),
        type: z.enum(["text", "ai", "system"]).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name,first_name,last_name")
      .eq("id", userId)
      .maybeSingle();
    const senderName =
      profile?.display_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      null;
    const { data: row, error } = await supabase
      .from("collab_messages")
      .insert({
        user_id: userId,
        space_id: data.spaceId,
        content: data.content,
        type: data.type ?? "text",
        sender_name: senderName,
        metadata: (data.metadata ?? {}) as never,
        message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const whatsapp =
      (data.type ?? "text") === "text"
        ? await sendSpaceMessageToWhatsapp({
            supabase,
            userId,
            spaceId: data.spaceId,
            content: data.content,
          })
        : { attempted: false, sent: false, reason: null, wa_message_id: null };

    if (whatsapp.attempted) {
      await supabase
        .from("collab_messages")
        .update({
          metadata: {
            ...(data.metadata ?? {}),
            whatsapp_sent: whatsapp.sent,
            whatsapp_error: whatsapp.sent ? null : whatsapp.reason,
            wa_message_id: whatsapp.wa_message_id,
          } as never,
        })
        .eq("id", row.id)
        .eq("user_id", userId);
    }

    return { id: row.id, whatsapp };
  });

/** Supprime un message (seulement le sien). */
export const deleteSpaceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_messages")
      .delete()
      .eq("id", data.messageId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Lie une entité (email, tâche, etc.) à un espace. */
export const linkEntityToSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        entityType: EntityType,
        entityId: z.string().uuid(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("collab_space_links")
      .upsert(
        {
          user_id: userId,
          space_id: data.spaceId,
          entity_type: data.entityType,
          entity_id: data.entityId,
          note: data.note ?? null,
        },
        { onConflict: "space_id,entity_type,entity_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

/** Supprime un lien. */
export const unlinkEntity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ linkId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_space_links")
      .delete()
      .eq("id", data.linkId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Liste toutes les entités liées à un espace, regroupées par type, avec un résumé léger. */
export const listSpaceLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: links, error } = await supabase
      .from("collab_space_links")
      .select("id,entity_type,entity_id,note,created_at")
      .eq("space_id", data.spaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const grouped: Record<string, string[]> = {};
    for (const l of links ?? []) {
      grouped[l.entity_type] ??= [];
      grouped[l.entity_type].push(l.entity_id);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enrich = async (
      table: string,
      ids: string[] | undefined,
      cols: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<Record<string, any>> => {
      if (!ids?.length) return {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows } = await (supabase.from(table as any) as any)
        .select(cols)
        .in("id", ids);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map: Record<string, any> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (rows ?? []) as any[]) {
        if (r && typeof r.id === "string") map[r.id] = r;
      }
      return map;
    };

    const [emails, tasks, meetings, documents, contacts] = await Promise.all([
      enrich("emails", grouped.email, "id,subject,from_address,received_at"),
      enrich("tasks", grouped.task, "id,title,status,due_at"),
      enrich("meetings", grouped.meeting, "id,title,start_at,end_at,status"),
      enrich("documents", grouped.document, "id,filename,mime_type"),
      enrich("contacts", grouped.contact, "id,first_name,last_name,organization"),
    ]);

    const enriched = (links ?? []).map((l) => {
      const bag =
        l.entity_type === "email"
          ? emails[l.entity_id]
          : l.entity_type === "task"
            ? tasks[l.entity_id]
            : l.entity_type === "meeting"
              ? meetings[l.entity_id]
              : l.entity_type === "document"
                ? documents[l.entity_id]
                : l.entity_type === "contact"
                  ? contacts[l.entity_id]
                  : null;
      return { ...l, entity: bag ?? null };
    });

    return { links: enriched };
  });

/** Activité 7 derniers jours (messages + liens) tous espaces ou un seul. */
export const getSpaceActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ spaceId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    let msgQ = supabase
      .from("collab_messages")
      .select("id,space_id,content,sender_name,message_at,type,metadata")
      .eq("user_id", userId)
      .gte("message_at", since)
      .order("message_at", { ascending: false })
      .limit(50);
    if (data.spaceId) msgQ = msgQ.eq("space_id", data.spaceId);
    const { data: messagesRaw } = await msgQ;
    const messages = (messagesRaw ?? []).filter(
      (m) => (m.metadata as { is_imported?: boolean } | null)?.is_imported !== true,
    );

    let linkQ = supabase
      .from("collab_space_links")
      .select("id,space_id,entity_type,entity_id,created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.spaceId) linkQ = linkQ.eq("space_id", data.spaceId);
    const { data: links } = await linkQ;

    return { messages, links: links ?? [] };
  });

/** Recherche de contacts pour @ mentions. */
export const searchMentionContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ q: z.string().max(80).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const q = (data.q ?? "").trim();
    let query = supabase
      .from("contacts")
      .select("id,first_name,last_name,organization,email")
      .eq("user_id", userId)
      .limit(8);
    if (q) {
      query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,organization.ilike.%${q}%`,
      );
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { contacts: rows ?? [] };
  });

/** Nombre de suggestions WA en attente. */
export const countPendingWaSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { count, error } = await supabase
      .from("wa_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/** Recherche globale pour le picker "+ Lier". */
export const searchLinkable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ q: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const q = data.q.trim();
    const like = `%${q}%`;
    const [emails, tasks, meetings, contacts, documents] = await Promise.all([
      supabase
        .from("emails")
        .select("id,subject,from_address,received_at")
        .eq("user_id", userId)
        .or(`subject.ilike.${like},from_address.ilike.${like}`)
        .order("received_at", { ascending: false })
        .limit(8),
      supabase
        .from("tasks")
        .select("id,title,status,due_at")
        .eq("user_id", userId)
        .ilike("title", like)
        .limit(8),
      supabase
        .from("meetings")
        .select("id,title,start_at")
        .eq("user_id", userId)
        .ilike("title", like)
        .order("start_at", { ascending: false })
        .limit(8),
      supabase
        .from("contacts")
        .select("id,first_name,last_name,organization")
        .eq("user_id", userId)
        .or(
          `first_name.ilike.${like},last_name.ilike.${like},organization.ilike.${like}`,
        )
        .limit(8),
      supabase
        .from("documents")
        .select("id,filename,mime_type")
        .eq("user_id", userId)
        .ilike("filename", like)
        .limit(8),
    ]);
    return {
      email: emails.data ?? [],
      task: tasks.data ?? [],
      meeting: meetings.data ?? [],
      contact: contacts.data ?? [],
      document: documents.data ?? [],
    };
  });

/** Liste les tâches liées à un espace + map linkId par tâche. */
export const listSpaceTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: links, error: lErr } = await supabase
      .from("collab_space_links")
      .select("id,entity_id")
      .eq("space_id", data.spaceId)
      .eq("entity_type", "task");
    if (lErr) throw new Error(lErr.message);
    const ids = (links ?? []).map((l) => l.entity_id);
    const linkByTaskId: Record<string, string> = {};
    for (const l of links ?? []) linkByTaskId[l.entity_id] = l.id;
    if (!ids.length) return { tasks: [], linkByTaskId };
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { tasks: tasks ?? [], linkByTaskId };
  });

/** Liste les réunions liées à un espace + map linkId par meeting. */
export const listSpaceMeetings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: links, error: lErr } = await supabase
      .from("collab_space_links")
      .select("id,entity_id")
      .eq("space_id", data.spaceId)
      .eq("entity_type", "meeting");
    if (lErr) throw new Error(lErr.message);
    const ids = (links ?? []).map((l) => l.entity_id);
    const linkByMeetingId: Record<string, string> = {};
    for (const l of links ?? []) linkByMeetingId[l.entity_id] = l.id;
    if (!ids.length) return { meetings: [], linkByMeetingId };
    const { data: meetings, error } = await supabase
      .from("meetings")
      .select(
        "id,title,description,start_at,end_at,location,is_online,online_link,online_provider,status,organizer_name,organizer_email",
      )
      .in("id", ids)
      .order("start_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { meetings: meetings ?? [], linkByMeetingId };
  });

/** Liste les documents (fichiers) liés à un espace. */
export const listSpaceFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: links, error: lErr } = await supabase
      .from("collab_space_links")
      .select("id,entity_id,user_id,created_at,note")
      .eq("space_id", data.spaceId)
      .eq("entity_type", "document");
    if (lErr) throw new Error(lErr.message);
    const ids = (links ?? []).map((l) => l.entity_id);
    const linkByDocId: Record<string, { linkId: string; uploaderId: string; linkedAt: string }> = {};
    for (const l of links ?? []) {
      linkByDocId[l.entity_id] = { linkId: l.id, uploaderId: l.user_id, linkedAt: l.created_at };
    }
    if (!ids.length) return { files: [], linkByDocId };
    const { data: files, error } = await supabase
      .from("documents")
      .select(
        "id,filename,original_filename,file_size,mime_type,storage_path,is_sensitive,local_only,user_id,created_at,description,tags",
      )
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { files: files ?? [], linkByDocId };
  });

/** Liste les imports WhatsApp d'un espace. */
export const listSpaceWaImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("collab_wa_imports")
      .select("id,filename,status,total_messages,imported_messages,error_message,created_at")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { imports: rows ?? [] };
  });

/** Met à jour la configuration WhatsApp d'un espace. */
export const updateSpaceWaConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        wa_group_name: z.string().max(160).nullable().optional(),
        whatsapp_phone_number: z.string().max(40).nullable().optional(),
        whatsapp_group_id: z.string().max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: {
      wa_group_name?: string | null;
      whatsapp_phone_number?: string | null;
      whatsapp_group_id?: string | null;
    } = {};
    if (data.wa_group_name !== undefined) patch.wa_group_name = data.wa_group_name || null;
    if (data.whatsapp_phone_number !== undefined)
      patch.whatsapp_phone_number = data.whatsapp_phone_number || null;
    if (data.whatsapp_group_id !== undefined)
      patch.whatsapp_group_id = data.whatsapp_group_id || null;
    const { error } = await supabase
      .from("collab_spaces")
      .update(patch)
      .eq("id", data.spaceId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Retourne la config WA + stats d'un espace. */
export const getSpaceWaInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: space, error } = await supabase
      .from("collab_spaces")
      .select("id,name,wa_group_name,whatsapp_phone_number,whatsapp_group_id")
      .eq("id", data.spaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const { count: pendingCount } = await supabase
      .from("wa_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .eq("status", "pending");
    return { space, pendingSuggestions: pendingCount ?? 0 };
  });

/** Liste les sondages de créneaux des réunions liées à un espace. */
export const listSpacePolls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: links, error: lErr } = await supabase
      .from("collab_space_links")
      .select("id,entity_id,created_at")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .eq("entity_type", "meeting");
    if (lErr) throw new Error(lErr.message);
    const meetingIds = (links ?? []).map((l) => l.entity_id);
    if (!meetingIds.length) return { polls: [] };

    const { data: polls, error: pErr } = await supabase
      .from("meeting_polls")
      .select("id,meeting_id,title,description,status,deadline,public_token,created_at")
      .in("meeting_id", meetingIds)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (pErr) throw new Error(pErr.message);
    const pollList = polls ?? [];
    if (!pollList.length) return { polls: [] };

    const pollIds = pollList.map((p) => p.id);
    const [{ data: slots }, { data: votes }, { data: meetings }] = await Promise.all([
      supabase
        .from("meeting_poll_slots")
        .select("id,poll_id,start_at,end_at,is_online,location")
        .in("poll_id", pollIds),
      supabase
        .from("meeting_poll_votes")
        .select("poll_id,slot_id,vote,voter_email")
        .in("poll_id", pollIds),
      supabase
        .from("meetings")
        .select("id,title,confirmed_slot_id")
        .in("id", meetingIds),
    ]);

    const meetingMap = new Map((meetings ?? []).map((m) => [m.id, m]));
    return {
      polls: pollList.map((p) => {
        const pSlots = (slots ?? []).filter((s) => s.poll_id === p.id);
        const pVotes = (votes ?? []).filter((v) => v.poll_id === p.id);
        const voters = new Set(pVotes.map((v) => v.voter_email)).size;
        const m = meetingMap.get(p.meeting_id);
        return {
          ...p,
          meeting_title: m?.title ?? null,
          confirmed_slot_id: m?.confirmed_slot_id ?? null,
          slots_count: pSlots.length,
          votes_count: pVotes.length,
          voters_count: voters,
        };
      }),
    };
  });

/** Timeline du fil WhatsApp d'un espace : historique importé + messages Hub ajoutés ensuite. */
export const listSpaceWaTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        q: z.string().max(200).optional(),
        sender: z.string().max(200).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let query = supabase
      .from("collab_messages")
      .select("id,content,sender_name,message_at,metadata,type")
      .eq("space_id", data.spaceId)
      .order("message_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.q && data.q.trim()) query = query.ilike("content", `%${data.q.trim()}%`);
    if (data.sender && data.sender.trim()) query = query.ilike("sender_name", `%${data.sender.trim()}%`);
    if (data.from) query = query.gte("message_at", data.from);
    if (data.to) query = query.lte("message_at", data.to);

    const { data: messages, error } = await query;
    if (error) throw new Error(error.message);

    // Liste distincte d'expéditeurs (sur l'échantillon retourné)
    const senders = Array.from(
      new Set((messages ?? []).map((m) => m.sender_name).filter(Boolean) as string[]),
    ).sort();

    return { messages: messages ?? [], senders };
  });

/* ============================================================
 * SONDAGES D'OPINION (collab_surveys)
 * ============================================================ */

const SurveyQuestionInput = z.object({
  label: z.string().min(1).max(500),
  type: z.enum(["text", "long_text", "single_choice", "multi_choice", "rating", "yes_no"]),
  options: z.array(z.string().min(1).max(200)).max(20).optional(),
  required: z.boolean().optional(),
});

/** Liste les sondages d'opinion d'un espace + comptage des réponses. */
export const listSpaceSurveys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("collab_surveys")
      .select("id,title,description,public_token,status,deadline,allow_anonymous,created_at,updated_at")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const counts = new Map<string, { q: number; r: number }>();
    if (ids.length > 0) {
      const [{ data: qs }, { data: rs }] = await Promise.all([
        supabase.from("collab_survey_questions").select("survey_id").in("survey_id", ids),
        supabase.from("collab_survey_responses").select("survey_id").in("survey_id", ids),
      ]);
      (qs ?? []).forEach((q) => {
        const c = counts.get(q.survey_id) ?? { q: 0, r: 0 };
        c.q += 1;
        counts.set(q.survey_id, c);
      });
      (rs ?? []).forEach((r) => {
        const c = counts.get(r.survey_id) ?? { q: 0, r: 0 };
        c.r += 1;
        counts.set(r.survey_id, c);
      });
    }

    return {
      surveys: (rows ?? []).map((s) => ({
        ...s,
        questions_count: counts.get(s.id)?.q ?? 0,
        responses_count: counts.get(s.id)?.r ?? 0,
      })),
    };
  });

/** Crée un sondage d'opinion avec ses questions. */
export const createSpaceSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        deadline: z.string().datetime().optional(),
        allow_anonymous: z.boolean().optional(),
        questions: z.array(SurveyQuestionInput).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: survey, error } = await supabase
      .from("collab_surveys")
      .insert({
        user_id: userId,
        space_id: data.spaceId,
        title: data.title,
        description: data.description ?? null,
        deadline: data.deadline ?? null,
        allow_anonymous: data.allow_anonymous ?? true,
      })
      .select("id,public_token")
      .single();
    if (error) throw new Error(error.message);

    const rows = data.questions.map((q, idx) => ({
      survey_id: survey.id,
      label: q.label,
      type: q.type,
      options: q.options ?? [],
      required: q.required ?? false,
      position: idx,
    }));
    const { error: qErr } = await supabase.from("collab_survey_questions").insert(rows);
    if (qErr) throw new Error(qErr.message);

    return { survey };
  });

/** Met à jour le statut d'un sondage (open/closed). */
export const updateSpaceSurveyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "closed"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_surveys")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Supprime un sondage (et ses questions/réponses par cascade applicative). */
export const deleteSpaceSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("collab_survey_responses").delete().eq("survey_id", data.id);
    await supabase.from("collab_survey_questions").delete().eq("survey_id", data.id);
    const { error } = await supabase
      .from("collab_surveys")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Détail d'un sondage + questions + réponses (vue propriétaire). */
export const getSpaceSurveyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: survey, error } = await supabase
      .from("collab_surveys")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !survey) throw new Error("Sondage introuvable");

    const [{ data: questions }, { data: responses }] = await Promise.all([
      supabase
        .from("collab_survey_questions")
        .select("*")
        .eq("survey_id", data.id)
        .order("position", { ascending: true }),
      supabase
        .from("collab_survey_responses")
        .select("*")
        .eq("survey_id", data.id)
        .order("submitted_at", { ascending: false }),
    ]);

    return { survey, questions: questions ?? [], responses: responses ?? [] };
  });

/** Lecture publique d'un espace via son token (anon ok si is_public).
 *  Si guest_token fourni et valide, élève le rôle (viewer / contributor)
 *  → contributor voit aussi les sondages clôturés. */
export const getPublicSpace = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(8).max(64),
        guest_token: z.string().min(8).max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
    const sb = createClient(url, key);

    const { data: space, error } = await sb
      .from("collab_spaces")
      .select("id,name,icon,color,public_description,public_token,is_public")
      .eq("public_token", data.token)
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!space) return { space: null, surveys: [], polls: [], guest: null };

    // Optional guest lookup
    let guest: { id: string; name: string; role: "viewer" | "contributor" } | null = null;
    if (data.guest_token) {
      const { data: g } = await sb
        .from("collab_guests")
        .select("id,name,role,space_id")
        .eq("access_token", data.guest_token)
        .eq("space_id", space.id)
        .maybeSingle();
      if (g) {
        guest = { id: g.id, name: g.name, role: (g.role as "viewer" | "contributor") ?? "viewer" };
        // Update last_active_at (best-effort, no await on error)
        await sb.from("collab_guests").update({ last_active_at: new Date().toISOString() }).eq("id", g.id);
      }
    }

    const isContributor = guest?.role === "contributor";

    let surveysQ = sb
      .from("collab_surveys")
      .select("id,title,description,public_token,status,deadline,allow_anonymous")
      .eq("space_id", space.id)
      .order("created_at", { ascending: false });
    if (!isContributor) surveysQ = surveysQ.eq("status", "open");
    const [{ data: surveys }, { data: links }] = await Promise.all([
      surveysQ,
      sb
        .from("collab_space_links")
        .select("entity_id")
        .eq("space_id", space.id)
        .eq("entity_type", "meeting"),
    ]);

    const meetingIds = (links ?? []).map((l) => l.entity_id);
    let polls: Array<{ id: string; title: string; public_token: string; status: string; deadline: string | null }> = [];
    if (meetingIds.length > 0) {
      let pollsQ = sb
        .from("meeting_polls")
        .select("id,title,public_token,status,deadline")
        .in("meeting_id", meetingIds);
      if (!isContributor) pollsQ = pollsQ.eq("status", "open");
      const { data: pollRows } = await pollsQ;
      polls = pollRows ?? [];
    }

    return { space, surveys: surveys ?? [], polls, guest };
  });

/** Liste les invités d'un espace (owner only). */
export const listSpaceGuests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("collab_guests")
      .select("id,name,email,role,access_token,status,created_at,last_active_at")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { guests: rows ?? [] };
  });

/** Ajoute un invité (génère un access_token unique) et envoie optionnellement l'email d'invitation. */
export const addSpaceGuest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        name: z.string().min(1).max(160),
        email: z.string().email().max(255).nullable().optional(),
        role: z.enum(["viewer", "contributor"]).default("viewer"),
        sendInvitation: z.boolean().optional(),
        appOrigin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("collab_guests")
      .insert({
        space_id: data.spaceId,
        user_id: userId,
        name: data.name,
        email: data.email ?? null,
        role: data.role,
      })
      .select("id,name,email,role,access_token,status,created_at")
      .single();
    if (error) throw new Error(error.message);

    let emailSent = false;
    let emailReason: string | undefined;
    if (data.sendInvitation && data.email && row?.access_token) {
      const [{ data: space }, { data: profile }] = await Promise.all([
        supabase
          .from("collab_spaces")
          .select("name,public_token,public_description,is_public")
          .eq("id", data.spaceId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name,first_name,last_name,email")
          .eq("id", userId)
          .maybeSingle(),
      ]);
      if (space?.public_token && space.is_public) {
        const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
        const accessUrl = `${origin}/space/${space.public_token}?g=${row.access_token}`;
        const inviterName =
          profile?.display_name ||
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
          profile?.email ||
          "Un collaborateur";
        const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
        const result = await sendTransactionalEmailServer({
          templateName: "space-invitation",
          recipientEmail: data.email,
          idempotencyKey: `space-invite-${row.id}`,
          templateData: {
            guestName: row.name,
            inviterName,
            spaceName: space.name,
            spaceDescription: space.public_description,
            role: row.role,
            accessUrl,
          },
        });
        emailSent = result.success;
        emailReason = result.reason;
      } else {
        emailReason = "space_not_public";
      }
    }
    return { guest: row, emailSent, emailReason };
  });

/** Ajoute plusieurs invités à partir d'un groupe de contacts et envoie l'invitation. */
export const addSpaceGuestsFromGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        groupId: z.string().uuid(),
        role: z.enum(["viewer", "contributor"]).default("viewer"),
        sendInvitation: z.boolean().default(true),
        appOrigin: z.string().url().optional(),
        memberIds: z.array(z.string().uuid()).max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ownership check + load group
    const { data: grp } = await supabase
      .from("collab_contact_groups")
      .select("id, user_id")
      .eq("id", data.groupId)
      .maybeSingle();
    if (!grp || grp.user_id !== userId) throw new Error("Groupe introuvable");

    // Load space (for invitation email)
    const { data: space } = await supabase
      .from("collab_spaces")
      .select("id,user_id,name,public_token,public_description,is_public")
      .eq("id", data.spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) throw new Error("Projet introuvable");

    // Members (optionally filtered to a user-selected subset)
    let memberQ = supabase
      .from("contact_group_members")
      .select("id, contact_id, external_email, external_name")
      .eq("group_id", data.groupId);
    if (data.memberIds && data.memberIds.length > 0) {
      memberQ = memberQ.in("id", data.memberIds);
    }
    const { data: members } = await memberQ;

    const contactIds = (members ?? [])
      .map((m) => m.contact_id)
      .filter((x): x is string => !!x);
    let contactsById: Record<string, { email: string | null; first_name: string | null; last_name: string | null }> = {};
    if (contactIds.length > 0) {
      const { data: cs } = await supabase
        .from("contacts")
        .select("id, email, first_name, last_name")
        .in("id", contactIds);
      contactsById = Object.fromEntries(
        (cs ?? []).map((c) => [
          c.id,
          {
            email: Array.isArray(c.email) ? c.email[0] ?? null : (c.email ?? null),
            first_name: c.first_name,
            last_name: c.last_name,
          },
        ]),
      );
    }

    // Existing guests (avoid duplicates by email)
    const { data: existingGuests } = await supabase
      .from("collab_guests")
      .select("email")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId);
    const existingEmails = new Set(
      (existingGuests ?? [])
        .map((g) => (g.email || "").toLowerCase())
        .filter(Boolean),
    );

    // Build recipient list (dedupe by email)
    type R = { name: string; email: string };
    const recipients: R[] = [];
    const seen = new Set<string>();
    for (const m of members ?? []) {
      const c = m.contact_id ? contactsById[m.contact_id] : null;
      const email = (c?.email || m.external_email || "").trim();
      if (!email) continue;
      const low = email.toLowerCase();
      if (seen.has(low) || existingEmails.has(low)) continue;
      seen.add(low);
      const name =
        [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() ||
        m.external_name ||
        email.split("@")[0];
      recipients.push({ name, email });
    }

    if (recipients.length === 0) {
      return { added: 0, invited: 0, skipped: 0, total: (members ?? []).length };
    }

    // Inviter profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name,first_name,last_name,email")
      .eq("id", userId)
      .maybeSingle();
    const inviterName =
      profile?.display_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      profile?.email ||
      "Un collaborateur";

    let added = 0;
    let invited = 0;
    const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
    const canSend = data.sendInvitation && space.is_public && !!space.public_token;
    const { sendTransactionalEmailServer } = canSend
      ? await import("@/lib/email/send.server")
      : ({ sendTransactionalEmailServer: null } as const);

    for (const r of recipients) {
      const { data: inserted, error: insErr } = await supabase
        .from("collab_guests")
        .insert({
          space_id: data.spaceId,
          user_id: userId,
          name: r.name,
          email: r.email,
          role: data.role,
        })
        .select("id,access_token,name,role")
        .single();
      if (insErr || !inserted) continue;
      added++;

      if (canSend && sendTransactionalEmailServer) {
        const accessUrl = `${origin}/space/${space.public_token}?g=${inserted.access_token}`;
        const res = await sendTransactionalEmailServer({
          templateName: "space-invitation",
          recipientEmail: r.email,
          idempotencyKey: `space-invite-${inserted.id}`,
          templateData: {
            guestName: inserted.name,
            inviterName,
            spaceName: space.name,
            spaceDescription: space.public_description,
            role: inserted.role,
            accessUrl,
          },
        });
        if (res.success) invited++;
      }
    }

    return {
      added,
      invited,
      skipped: (members ?? []).length - added,
      total: (members ?? []).length,
    };
  });

/** (Re)envoie l'email d'invitation pour un invité existant. */
export const resendSpaceGuestInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        guestId: z.string().uuid(),
        appOrigin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: guest } = await supabase
      .from("collab_guests")
      .select("id,name,email,role,access_token,space_id,user_id")
      .eq("id", data.guestId)
      .maybeSingle();
    if (!guest || guest.user_id !== userId) throw new Error("Invité introuvable");
    if (!guest.email) throw new Error("Cet invité n'a pas d'email");

    const [{ data: space }, { data: profile }] = await Promise.all([
      supabase
        .from("collab_spaces")
        .select("name,public_token,public_description,is_public")
        .eq("id", guest.space_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name,first_name,last_name,email")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (!space?.public_token || !space.is_public) {
      throw new Error("L'espace doit être public pour envoyer une invitation");
    }
    const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
    const accessUrl = `${origin}/space/${space.public_token}?g=${guest.access_token}`;
    const inviterName =
      profile?.display_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      profile?.email ||
      "Un collaborateur";
    const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
    const result = await sendTransactionalEmailServer({
      templateName: "space-invitation",
      recipientEmail: guest.email,
      idempotencyKey: `space-invite-${guest.id}-${Date.now()}`,
      templateData: {
        guestName: guest.name,
        inviterName,
        spaceName: space.name,
        spaceDescription: space.public_description,
        role: guest.role,
        accessUrl,
      },
    });
    return { success: result.success, reason: result.reason };
  });

/** Met à jour le rôle d'un invité. */
export const updateSpaceGuestRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        role: z.enum(["viewer", "contributor"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_guests")
      .update({ role: data.role })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Supprime un invité. */
export const removeSpaceGuest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_guests")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Envoie un email d'information (nouveau contenu, mise à jour…) à un ou plusieurs invités d'un espace. */
export const notifySpaceGuests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        guestIds: z.array(z.string().uuid()).optional(),
        subjectLine: z.string().min(1).max(200),
        message: z.string().min(1).max(4000),
        appOrigin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: space }, { data: profile }] = await Promise.all([
      supabase
        .from("collab_spaces")
        .select("name,public_token,is_public,user_id")
        .eq("id", data.spaceId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name,first_name,last_name,email")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (!space || space.user_id !== userId) throw new Error("Espace introuvable");
    if (!space.is_public || !space.public_token) {
      throw new Error("Rendez l'espace public pour pouvoir notifier les invités.");
    }
    let q = supabase
      .from("collab_guests")
      .select("id,name,email,access_token")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .not("email", "is", null);
    if (data.guestIds && data.guestIds.length > 0) q = q.in("id", data.guestIds);
    const { data: guests, error: gErr } = await q;
    if (gErr) throw new Error(gErr.message);
    const recipients = (guests ?? []).filter((g) => !!g.email && !!g.access_token);
    if (recipients.length === 0) return { sent: 0, failed: 0 };

    const inviterName =
      profile?.display_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      profile?.email ||
      "Un collaborateur";
    const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
    const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
    const stamp = Date.now();
    let sent = 0;
    let failed = 0;
    for (const g of recipients) {
      const accessUrl = `${origin}/space/${space.public_token}?g=${g.access_token}`;
      try {
        const res = await sendTransactionalEmailServer({
          templateName: "space-update",
          recipientEmail: g.email!,
          idempotencyKey: `space-update-${g.id}-${stamp}`,
          templateData: {
            guestName: g.name,
            inviterName,
            spaceName: space.name,
            subjectLine: data.subjectLine,
            message: data.message,
            accessUrl,
          },
        });
        if (res.success) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  });

/** Historique des emails envoyés (invitations + notifications) aux invités d'un espace. */
export const listSpaceGuestEmailHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: guests, error: gErr } = await supabase
      .from("collab_guests")
      .select("id,email")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId)
      .not("email", "is", null);
    if (gErr) throw new Error(gErr.message);
    const emails = (guests ?? []).map((g) => g.email!).filter(Boolean);
    if (emails.length === 0) return { history: [] as Array<{ id: string; recipient_email: string; template_name: string; status: string; error_message: string | null; created_at: string }> };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: logs, error: lErr } = await supabaseAdmin
      .from("email_send_log")
      .select("id,recipient_email,template_name,status,error_message,created_at")
      .in("recipient_email", emails)
      .in("template_name", ["space-invitation", "space-update"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (lErr) throw new Error(lErr.message);
    return { history: logs ?? [] };
  });

/** Active/désactive l'accès public d'un espace + description publique. */
export const setSpacePublic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        is_public: z.boolean(),
        public_description: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("collab_spaces")
      .update({
        is_public: data.is_public,
        public_description: data.public_description ?? null,
      })
      .eq("id", data.spaceId)
      .eq("user_id", userId)
      .select("id,is_public,public_token,public_description")
      .single();
    if (error) throw new Error(error.message);
    return { space: row };
  });

/** Récupère les paramètres publics d'un espace (token, is_public, description). */
export const getSpacePublicSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("collab_spaces")
      .select("id,is_public,public_token,public_description")
      .eq("id", data.spaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { space: row };
  });

/** Lecture publique d'un sondage via son token (questions + métadonnées espace). */
export const getPublicSurvey = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
    const sb = createClient(url, key);

    const { data: survey, error } = await sb
      .from("collab_surveys")
      .select("id,title,description,status,deadline,allow_anonymous,public_token,space_id")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!survey) return { survey: null, questions: [], space: null };

    const [{ data: questions }, { data: space }] = await Promise.all([
      sb
        .from("collab_survey_questions")
        .select("id,label,type,options,required,position")
        .eq("survey_id", survey.id)
        .order("position", { ascending: true }),
      sb
        .from("collab_spaces")
        .select("id,name,icon,color")
        .eq("id", survey.space_id)
        .maybeSingle(),
    ]);

    return { survey, questions: questions ?? [], space };
  });

/** Soumission anonyme/identifiée d'une réponse à un sondage public. */
export const submitPublicSurveyResponse = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(8).max(64),
        respondent_name: z.string().max(160).nullable().optional(),
        respondent_email: z.string().email().max(255).nullable().optional(),
        answers: z.record(z.string(), z.unknown()),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
    const sb = createClient(url, key);

    const { data: survey, error: sErr } = await sb
      .from("collab_surveys")
      .select("id,status,allow_anonymous")
      .eq("public_token", data.token)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!survey) throw new Error("Sondage introuvable");
    if (survey.status !== "open") throw new Error("Sondage clôturé");
    if (!survey.allow_anonymous && !data.respondent_email) {
      throw new Error("Email requis pour ce sondage");
    }

    // Anti-doublon par email si fourni
    if (data.respondent_email) {
      const { data: existing } = await sb
        .from("collab_survey_responses")
        .select("id")
        .eq("survey_id", survey.id)
        .eq("respondent_email", data.respondent_email)
        .maybeSingle();
      if (existing) throw new Error("Vous avez déjà répondu à ce sondage");
    }

    const { error: iErr } = await sb.from("collab_survey_responses").insert({
      survey_id: survey.id,
      respondent_name: data.respondent_name ?? null,
      respondent_email: data.respondent_email ?? null,
      answers: data.answers,
    });
    if (iErr) throw new Error(iErr.message);
    return { ok: true };
  });

/** Crée un lien URL externe dans un espace. */
export const createSpaceUrlLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        title: z.string().min(1).max(300),
        url: z.string().url().max(2000),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("collab_space_url_links")
      .insert({
        user_id: userId,
        space_id: data.spaceId,
        title: data.title,
        url: data.url,
        note: data.note ?? null,
      })
      .select("id,title,url,note,created_at")
      .single();
    if (error) throw new Error(error.message);
    return { link: row };
  });

/** Liste les liens URL externes d'un espace. */
export const listSpaceUrlLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("collab_space_url_links")
      .select("id,title,url,note,created_at")
      .eq("space_id", data.spaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: rows ?? [] };
  });

/** Supprime un lien URL externe. */
export const deleteSpaceUrlLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ linkId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_space_url_links")
      .delete()
      .eq("id", data.linkId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Liste les collaborateurs d'un espace : membres des groupes de contacts liés + invités (avec dernière connexion). */
export const listSpaceCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Groups linked to this space
    const { data: groups } = await supabase
      .from("collab_contact_groups")
      .select("id,name")
      .eq("user_id", userId)
      .eq("space_id", data.spaceId);

    const groupIds = (groups ?? []).map((g: { id: string }) => g.id);
    let groupMembers: Array<{
      group_id: string;
      contact_id: string | null;
      external_email: string | null;
      external_name: string | null;
      contact: {
        first_name: string | null;
        last_name: string | null;
        email: string[] | null;
        organization: string | null;
      } | null;
    }> = [];
    if (groupIds.length > 0) {
      const { data: rows } = await supabase
        .from("contact_group_members")
        .select(
          "group_id,contact_id,external_email,external_name,contact:contacts(first_name,last_name,email,organization)",
        )
        .in("group_id", groupIds);
      groupMembers = (rows ?? []) as typeof groupMembers;
    }

    // Guests for this space (with last_active_at)
    const { data: guests } = await supabase
      .from("collab_guests")
      .select("id,name,email,role,status,last_active_at,created_at")
      .eq("space_id", data.spaceId)
      .eq("user_id", userId);

    // Index guest activity by lowercased email
    const guestByEmail = new Map<
      string,
      { id: string; role: string; status: string; last_active_at: string | null }
    >();
    for (const g of guests ?? []) {
      if (g.email) guestByEmail.set(g.email.toLowerCase(), { id: g.id, role: g.role, status: g.status, last_active_at: g.last_active_at });
    }

    // Build merged collaborators list, deduped by lowercased email (or by name when no email)
    type Row = {
      key: string;
      name: string;
      email: string | null;
      organization: string | null;
      source: "group" | "guest";
      group_names: string[];
      role: string | null;
      invited: boolean;
      status: string | null;
      last_active_at: string | null;
      guest_id: string | null;
    };
    const byKey = new Map<string, Row>();
    const groupNameById = new Map<string, string>();
    for (const g of groups ?? []) groupNameById.set(g.id, g.name);

    for (const m of groupMembers) {
      const email =
        (Array.isArray(m.contact?.email) ? m.contact?.email?.[0] : null) ||
        m.external_email ||
        null;
      const name =
        [m.contact?.first_name, m.contact?.last_name].filter(Boolean).join(" ").trim() ||
        m.external_name ||
        (email ? email.split("@")[0] : "(sans nom)");
      const key = (email ?? `name:${name}`).toLowerCase();
      const existing = byKey.get(key);
      const groupName = groupNameById.get(m.group_id) ?? "";
      if (existing) {
        if (groupName && !existing.group_names.includes(groupName)) existing.group_names.push(groupName);
      } else {
        const g = email ? guestByEmail.get(email.toLowerCase()) : undefined;
        byKey.set(key, {
          key,
          name,
          email,
          organization: m.contact?.organization ?? null,
          source: "group",
          group_names: groupName ? [groupName] : [],
          role: g?.role ?? null,
          invited: !!g,
          status: g?.status ?? null,
          last_active_at: g?.last_active_at ?? null,
          guest_id: g?.id ?? null,
        });
      }
    }

    // Add guests not already in any linked group
    for (const g of guests ?? []) {
      const key = (g.email ?? `name:${g.name}`).toLowerCase();
      if (byKey.has(key)) {
        const r = byKey.get(key)!;
        r.invited = true;
        r.role = r.role ?? g.role;
        r.status = r.status ?? g.status;
        r.last_active_at = r.last_active_at ?? g.last_active_at;
        r.guest_id = r.guest_id ?? g.id;
      } else {
        byKey.set(key, {
          key,
          name: g.name,
          email: g.email,
          organization: null,
          source: "guest",
          group_names: [],
          role: g.role,
          invited: true,
          status: g.status,
          last_active_at: g.last_active_at,
          guest_id: g.id,
        });
      }
    }

    const collaborators = Array.from(byKey.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
    );

    return { collaborators, groupCount: groups?.length ?? 0 };
  });
