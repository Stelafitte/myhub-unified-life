import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EntityType = z.enum(["email", "task", "meeting", "document", "contact"]);

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
        metadata: data.metadata ?? {},
        message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
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

    const enrich = async <T extends Record<string, unknown>>(
      table: string,
      ids: string[] | undefined,
      cols: string,
    ): Promise<Record<string, T>> => {
      if (!ids?.length) return {};
      const { data: rows } = await supabase.from(table).select(cols).in("id", ids);
      const map: Record<string, T> = {};
      for (const r of (rows ?? []) as T[]) {
        map[(r as { id: string }).id] = r;
      }
      return map;
    };

    const [emails, tasks, meetings, documents, contacts] = await Promise.all([
      enrich<{ id: string; subject: string | null; from_address: string | null; received_at: string | null }>(
        "emails",
        grouped.email,
        "id,subject,from_address,received_at",
      ),
      enrich<{ id: string; title: string | null; status: string | null; due_at: string | null }>(
        "tasks",
        grouped.task,
        "id,title,status,due_at",
      ),
      enrich<{ id: string; title: string | null; start_at: string | null; end_at: string | null; status: string | null }>(
        "meetings",
        grouped.meeting,
        "id,title,start_at,end_at,status",
      ),
      enrich<{ id: string; filename: string | null; mime_type: string | null }>(
        "documents",
        grouped.document,
        "id,filename,mime_type",
      ),
      enrich<{ id: string; first_name: string | null; last_name: string | null; organization: string | null }>(
        "contacts",
        grouped.contact,
        "id,first_name,last_name,organization",
      ),
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
      .select("id,space_id,content,sender_name,message_at,type")
      .eq("user_id", userId)
      .gte("message_at", since)
      .order("message_at", { ascending: false })
      .limit(50);
    if (data.spaceId) msgQ = msgQ.eq("space_id", data.spaceId);
    const { data: messages } = await msgQ;

    let linkQ = supabase
      .from("collab_space_links")
      .select("id,space_id,entity_type,entity_id,created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.spaceId) linkQ = linkQ.eq("space_id", data.spaceId);
    const { data: links } = await linkQ;

    return { messages: messages ?? [], links: links ?? [] };
  });
