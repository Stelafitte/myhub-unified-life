import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getValidOutlookToken } from "./outlook-oauth.functions";

const GRAPH = "https://graph.microsoft.com/v1.0";

type OutlookEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  lastModifiedDateTime?: string;
  recurrence?: unknown;
};

function buildOutlookPayload(ev: {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    subject: ev.title,
    body: { contentType: "HTML", content: ev.description ?? "" },
    location: ev.location ? { displayName: ev.location } : undefined,
    isAllDay: ev.is_all_day,
  };
  if (ev.is_all_day) {
    const startDate = new Date(ev.start_at).toISOString().slice(0, 10);
    const endDate = new Date(ev.end_at).toISOString().slice(0, 10);
    payload.start = { dateTime: `${startDate}T00:00:00`, timeZone: "UTC" };
    payload.end = { dateTime: `${endDate}T00:00:00`, timeZone: "UTC" };
  } else {
    payload.start = { dateTime: new Date(ev.start_at).toISOString().replace("Z", ""), timeZone: "UTC" };
    payload.end = { dateTime: new Date(ev.end_at).toISOString().replace("Z", ""), timeZone: "UTC" };
  }
  return payload;
}

function parseOutlookDate(d?: { dateTime?: string; timeZone?: string }): string | null {
  if (!d?.dateTime) return null;
  // Microsoft returns naive dateTime, append Z if missing
  const s = d.dateTime.endsWith("Z") ? d.dateTime : `${d.dateTime}Z`;
  return new Date(s).toISOString();
}

export const syncOutlookCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { accessToken, connection } = await getValidOutlookToken(data.connectionId, userId);

    const startWindow = new Date(Date.now() - 30 * 86400_000).toISOString();
    const endWindow = new Date(Date.now() + 180 * 86400_000).toISOString();

    let created = 0;
    let updated = 0;
    let pushed = 0;
    const errors: string[] = [];

    const direction = (connection as { sync_direction: string }).sync_direction;
    const category = (connection as { category: string }).category ?? "pro";

    // ===== PULL: Outlook → local =====
    if (direction !== "push") {
      let nextLink: string | null =
        `${GRAPH}/me/calendarView?startDateTime=${startWindow}&endDateTime=${endWindow}&$top=200`;
      while (nextLink) {
        const pageRes: Response = await fetch(nextLink, {
          headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
        });
        const body: { value?: OutlookEvent[]; ["@odata.nextLink"]?: string; error?: { message?: string } } =
          await pageRes.json().catch(() => ({}));
        if (!pageRes.ok) throw new Error(`Outlook events error (${pageRes.status}): ${body.error?.message ?? "unknown"}`);
        
        const events: OutlookEvent[] = body.value ?? [];

        for (const ev of events) {
          try {
            if (ev.isCancelled) {
              await supabaseAdmin
                .from("calendar_events")
                .delete()
                .eq("user_id", userId)
                .eq("outlook_connection_id", data.connectionId)
                .eq("outlook_event_id", ev.id);
              continue;
            }
            const startISO = parseOutlookDate(ev.start);
            const endISO = parseOutlookDate(ev.end);
            if (!startISO || !endISO) continue;

            const { data: existing } = await supabaseAdmin
              .from("calendar_events")
              .select("id")
              .eq("user_id", userId)
              .eq("outlook_connection_id", data.connectionId)
              .eq("outlook_event_id", ev.id)
              .maybeSingle();

            const row = {
              user_id: userId,
              title: ev.subject ?? "(Sans titre)",
              description: ev.body?.content ?? ev.bodyPreview ?? null,
              location: ev.location?.displayName ?? null,
              start_at: startISO,
              end_at: endISO,
              is_all_day: Boolean(ev.isAllDay),
              outlook_connection_id: data.connectionId,
              outlook_event_id: ev.id,
              category,
              source: "outlook" as const,
              updated_at: new Date().toISOString(),
            };

            if (existing) {
              await supabaseAdmin.from("calendar_events").update(row).eq("id", existing.id);
              updated += 1;
            } else {
              await supabaseAdmin.from("calendar_events").insert(row);
              created += 1;
            }
          } catch (err) {
            errors.push((err as Error).message);
          }
        }
        nextLink = (body["@odata.nextLink"] as string | undefined) ?? null;
      }
    }

    // ===== PUSH: local → Outlook =====
    if (direction !== "pull") {
      const { data: locals } = await supabaseAdmin
        .from("calendar_events")
        .select("id,title,description,location,start_at,end_at,is_all_day,outlook_event_id,updated_at")
        .eq("user_id", userId)
        .eq("outlook_connection_id", data.connectionId);

      const lastSync = (connection as { last_sync_at: string | null }).last_sync_at;
      for (const ev of locals ?? []) {
        try {
          const payload = buildOutlookPayload(ev as never);
          if (!ev.outlook_event_id) {
            const res = await fetch(`${GRAPH}/me/events`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              errors.push(`push create: ${body.error?.message ?? res.status}`);
              continue;
            }
            await supabaseAdmin
              .from("calendar_events")
              .update({ outlook_event_id: body.id })
              .eq("id", ev.id);
            pushed += 1;
          } else if (lastSync && new Date(ev.updated_at) > new Date(lastSync)) {
            const res = await fetch(`${GRAPH}/me/events/${ev.outlook_event_id}`, {
              method: "PATCH",
              headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              errors.push(`push update: ${body.error?.message ?? res.status}`);
              continue;
            }
            pushed += 1;
          }
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
    }

    await supabaseAdmin
      .from("outlook_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", data.connectionId);

    return { created, updated, pushed, errors };
  });

export const pushOutlookCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };

    const { data: ev, error } = await supabaseAdmin
      .from("calendar_events")
      .select("*")
      .eq("id", data.eventId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !ev) throw new Error("Événement introuvable");

    let connectionId: string | null = ev.outlook_connection_id as string | null;
    if (!connectionId) {
      const { data: conn } = await supabaseAdmin
        .from("outlook_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("category", ev.category ?? "pro")
        .in("sync_direction", ["bidirectional", "push"])
        .maybeSingle();
      if (!conn) throw new Error("Aucune connexion Outlook active pour cette catégorie");
      connectionId = conn.id;
    }

    const { accessToken } = await getValidOutlookToken(connectionId, userId);
    const payload = buildOutlookPayload(ev as never);

    if (ev.outlook_event_id) {
      const res = await fetch(`${GRAPH}/me/events/${ev.outlook_event_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Outlook PATCH (${res.status}): ${body.error?.message ?? "unknown"}`);
      return { ok: true, action: "updated", outlookEventId: ev.outlook_event_id };
    }

    const res = await fetch(`${GRAPH}/me/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Outlook POST (${res.status}): ${body.error?.message ?? "unknown"}`);

    await supabaseAdmin
      .from("calendar_events")
      .update({ outlook_event_id: body.id, outlook_connection_id: connectionId })
      .eq("id", ev.id);

    return { ok: true, action: "created", outlookEventId: body.id as string };
  });
