import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface WaSuggestion {
  id: string;
  space_id: string;
  kind: "action" | "meeting" | "decision";
  status: "pending" | "approved" | "rejected";
  title: string;
  priority: string | null;
  meeting_start_at: string | null;
  meeting_end_at: string | null;
  source_sender: string | null;
  source_text: string | null;
  source_message_at: string | null;
  space_name?: string;
  created_at: string;
}

export const listWaSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        space_id: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("wa_suggestions")
      .select(
        "id, space_id, kind, status, title, priority, meeting_start_at, meeting_end_at, source_sender, source_text, source_message_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    if (data.space_id) q = q.eq("space_id", data.space_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Join space names
    const spaceIds = Array.from(new Set((rows ?? []).map((r) => r.space_id)));
    const nameMap = new Map<string, string>();
    if (spaceIds.length > 0) {
      const { data: spaces } = await supabase
        .from("collab_spaces")
        .select("id, name")
        .in("id", spaceIds);
      (spaces ?? []).forEach((s) => nameMap.set(s.id, s.name));
    }
    return {
      suggestions: (rows ?? []).map((r) => ({
        ...r,
        space_name: nameMap.get(r.space_id),
      })) as WaSuggestion[],
    };
  });

export const approveWaSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        // optional overrides
        title: z.string().min(1).max(300).optional(),
        meeting_start_at: z.string().datetime().optional(),
        meeting_end_at: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: sug, error } = await supabase
      .from("wa_suggestions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !sug) throw new Error("Suggestion introuvable");
    if (sug.status !== "pending") throw new Error("Déjà traitée");

    const { data: space } = await supabase
      .from("collab_spaces")
      .select("name")
      .eq("id", sug.space_id)
      .maybeSingle();
    const spaceName = space?.name ?? "Espace";

    const srcMsgAt = sug.source_message_at
      ? new Date(sug.source_message_at).toLocaleString("fr-FR")
      : "";
    const ctxNote = `Issu de WhatsApp (${sug.source_sender ?? "?"}, ${srcMsgAt}): « ${(sug.source_text ?? "").slice(0, 300)} »`;

    let createdTaskId: string | null = null;
    let createdEventId: string | null = null;

    if (sug.kind === "action") {
      const { data: t, error: tErr } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: (data.title ?? sug.title).slice(0, 200),
          description: ctxNote,
          status: "todo",
          priority: (sug.priority as "low" | "medium" | "urgent" | null) ?? "medium",
          source_app: "whatsapp",
          tags: ["proposition-whatsapp", `espace:${spaceName}`],
        })
        .select("id")
        .single();
      if (tErr) throw new Error(tErr.message);
      createdTaskId = t.id;
    } else if (sug.kind === "meeting") {
      const start = data.meeting_start_at ?? sug.meeting_start_at;
      if (!start) throw new Error("Date de réunion manquante");
      const end =
        data.meeting_end_at ??
        sug.meeting_end_at ??
        new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
      const { data: ev, error: cErr } = await supabase
        .from("calendar_events")
        .insert({
          user_id: userId,
          title: (data.title ?? sug.title).slice(0, 200),
          description: ctxNote,
          start_at: start,
          end_at: end,
          category: "pro",
        })
        .select("id")
        .single();
      if (cErr) throw new Error(cErr.message);
      createdEventId = ev.id;
    } else if (sug.kind === "decision") {
      const { error: mErr } = await supabase.from("collab_messages").insert({
        space_id: sug.space_id,
        user_id: userId,
        content: (data.title ?? sug.title).slice(0, 1000),
        type: "decision",
        sender_name: sug.source_sender,
        message_at: sug.source_message_at ?? new Date().toISOString(),
        metadata: { is_imported: true, badge: "Décision" },
      });
      if (mErr) throw new Error(mErr.message);
    }

    await supabase
      .from("wa_suggestions")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        created_task_id: createdTaskId,
        created_event_id: createdEventId,
      })
      .eq("id", sug.id);

    return { ok: true };
  });

export const rejectWaSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_suggestions")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
