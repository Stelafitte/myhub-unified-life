import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
].join(" ");

const PREVIEW_OAUTH_ORIGIN = "https://id-preview--723c3dcd-e4f6-4fec-98f4-4db15daebc63.lovable.app";

function getOAuthOrigin(origin: string): string {
  const host = new URL(origin).hostname;
  if (host.endsWith(".lovableproject.com")) return PREVIEW_OAUTH_ORIGIN;
  return origin;
}

function getOrigin(): string {
  const req = getRequest();
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  return getOAuthOrigin(`${proto}://${host}`);
}

export const startGoogleCalendarOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      label: z.string().min(1).max(80).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_CALENDAR_CLIENT_ID is not configured.");
    }
    const { userId } = context as { userId: string };

    const state = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("oauth_states").insert({
      state,
      user_id: userId,
      provider: "google_calendar",
      label: data.label ?? "Google Calendar",
    });
    if (error) {
      throw new Error(`Failed to create OAuth session: ${error.message}`);
    }

    const redirectUri = `${getOrigin()}/api/google-calendar/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });

    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
      state,
    };
  });

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Refresh token failed (${res.status}): ${body.error_description ?? body.error ?? "unknown"}`);
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  colorId?: string;
};

function buildGooglePayload(ev: {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  recurrence_rule: string | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    summary: ev.title,
    description: ev.description ?? undefined,
    location: ev.location ?? undefined,
  };
  if (ev.is_all_day) {
    payload.start = { date: new Date(ev.start_at).toISOString().slice(0, 10) };
    payload.end = { date: new Date(ev.end_at).toISOString().slice(0, 10) };
  } else {
    payload.start = { dateTime: new Date(ev.start_at).toISOString() };
    payload.end = { dateTime: new Date(ev.end_at).toISOString() };
  }
  if (ev.recurrence_rule) {
    const r = ev.recurrence_rule.startsWith("RRULE:")
      ? ev.recurrence_rule
      : `RRULE:${ev.recurrence_rule}`;
    payload.recurrence = [r];
  }
  return payload;
}

/**
 * Push local-only events (or locally-edited events) to Google Calendar.
 * - Events with gcal_connection_id set but no google_event_id → POST (create on Google).
 * - Events whose updated_at is newer than the connection's last_sync_at and that
 *   already have a google_event_id → PATCH (update on Google).
 * Returns the count of events successfully pushed.
 */
async function pushLocalEventsForConnection(
  conn: {
    id: string;
    user_id: string;
    calendar_id: string | null;
    last_sync_at: string | null;
    sync_direction: string;
    category?: string | null;
  },
  accessToken: string,
): Promise<number> {
  if (conn.sync_direction === "pull") return 0;

  const calendarId = encodeURIComponent(conn.calendar_id || "primary");
  let pushed = 0;

  // Les événements créés dans le Hub n'ont pas toujours encore de lien Google :
  // on les rattache à l'agenda actif de même catégorie avant le push.
  await supabaseAdmin
    .from("calendar_events")
    .update({ gcal_connection_id: conn.id, sync_direction: conn.sync_direction as "bidirectional" | "pull" | "push" })
    .eq("user_id", conn.user_id)
    .eq("category", conn.category === "perso" ? "perso" : "pro")
    .is("account_id", null)
    .is("gcal_connection_id", null)
    .is("google_event_id", null);

  const { data: maybeToCreate, error: createLoadErr } = await supabaseAdmin
    .from("calendar_events")
    .select("id, title, description, location, start_at, end_at, is_all_day, recurrence_rule, google_event_id")
    .eq("user_id", conn.user_id)
    .eq("gcal_connection_id", conn.id)
    .limit(1000);
  if (createLoadErr) throw new Error(`Failed to load local events to push: ${createLoadErr.message}`);
  const toCreate = (maybeToCreate ?? []).filter((ev) => !ev.google_event_id);

  for (const ev of toCreate) {
    const payload = buildGooglePayload(ev);
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        console.warn("Google create failed", res.status, await res.text().catch(() => ""));
        continue;
      }
      const body = (await res.json()) as { id?: string };
      if (body.id) {
        const { error: markErr } = await supabaseAdmin
          .from("calendar_events")
          .update({ google_event_id: body.id, external_id: body.id, source: "google", sync_direction: "bidirectional" })
          .eq("id", ev.id);
        if (markErr) throw new Error(`Failed to mark Google event as synced: ${markErr.message}`);
        pushed++;
      }
    } catch (e) {
      console.warn("Google create error", e);
    }
  }

  if (conn.last_sync_at) {
    const { data: toUpdate, error: updateLoadErr } = await supabaseAdmin
      .from("calendar_events")
      .select("id, google_event_id, title, description, location, start_at, end_at, is_all_day, recurrence_rule")
      .eq("user_id", conn.user_id)
      .eq("gcal_connection_id", conn.id)
      .not("google_event_id", "is", null)
      .gt("updated_at", conn.last_sync_at)
      .limit(100);
    if (updateLoadErr) throw new Error(`Failed to load edited events to push: ${updateLoadErr.message}`);

    for (const ev of toUpdate ?? []) {
      if (!ev.google_event_id) continue;
      const payload = buildGooglePayload(ev);
      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(ev.google_event_id)}`,
          {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          console.warn("Google patch failed", res.status, await res.text().catch(() => ""));
          continue;
        }
        pushed++;
      } catch (e) {
        console.warn("Google patch error", e);
      }
    }
  }

  return pushed;
}

export const syncGoogleCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}).optional())
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };

    const { data: connections, error: connErr } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (connErr) throw new Error(`Failed to load connections: ${connErr.message}`);
    if (!connections || connections.length === 0) {
      return { synced: 0, connections: 0 };
    }

    let totalSynced = 0;
    let totalPushed = 0;

    for (const conn of connections) {
      // Calendar events are tied to gcal_connection_id directly — we do NOT
      // create an `accounts` row for the calendar connection (that would
      // pollute Comptes, Synchro, Contacts, Plan d'opération, etc.).
      const accountId: string | null = null;



      // Refresh token if expired (or about to)
      let accessToken = conn.access_token;
      if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
        try {
          const refreshed = await refreshAccessToken(conn.refresh_token);
          accessToken = refreshed.accessToken;
          await supabaseAdmin
            .from("google_calendar_connections")
            .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
            .eq("id", conn.id);
        } catch (e) {
          console.error("Token refresh failed for connection", conn.id, e);
          continue;
        }
      }

      // Bidirectional: push local changes BEFORE pulling remote ones
      try {
        totalPushed += await pushLocalEventsForConnection(
          {
            id: conn.id,
            user_id: userId,
            calendar_id: conn.calendar_id,
            last_sync_at: conn.last_sync_at,
            sync_direction: conn.sync_direction,
            category: conn.category,
          },
          accessToken,
        );
      } catch (e) {
        console.warn("Push to Google failed for connection", conn.id, e);
      }

      // Fetch events: from 30 days ago to 180 days ahead
      const timeMin = new Date(Date.now() - 30 * 86400_000).toISOString();
      const timeMax = new Date(Date.now() + 180 * 86400_000).toISOString();
      const calendarId = encodeURIComponent(conn.calendar_id || "primary");

      let pageToken: string | undefined;
      const fetchedIds: string[] = [];

      do {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params.toString()}`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        );

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error("Google Calendar list failed", res.status, errBody);
          throw new Error(`Google Calendar API ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const body = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
        const items = body.items ?? [];

        // Filter out events the user has locally tombstoned
        const candidateIds = items.map((ev) => ev.id).filter(Boolean);
        let tombstoned = new Set<string>();
        if (candidateIds.length > 0) {
          const { data: dele } = await supabaseAdmin
            .from("deleted_calendar_events")
            .select("google_event_id")
            .eq("gcal_connection_id", conn.id)
            .in("google_event_id", candidateIds);
          tombstoned = new Set((dele ?? []).map((r: { google_event_id: string }) => r.google_event_id));
        }

        const rows = items
          .filter((ev) => ev.status !== "cancelled" && !tombstoned.has(ev.id))
          .map((ev) => {
            const startStr = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
            const endStr = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
            if (!startStr || !endStr) return null;
            const isAllDay = !!ev.start?.date && !ev.start?.dateTime;
            const connCategory = (conn as { category?: string }).category === "perso" ? "perso" : "pro";
            const connColor = (conn as { color?: string | null }).color ?? (connCategory === "perso" ? "#f97316" : "#6366f1");
            return {
              user_id: userId,
              account_id: accountId,
              gcal_connection_id: conn.id,
              google_event_id: ev.id,
              external_id: ev.id,
              title: ev.summary ?? "(sans titre)",
              description: ev.description ?? null,
              location: ev.location ?? null,
              start_at: startStr,
              end_at: endStr,
              is_all_day: isAllDay,
              source: "google" as const,
              sync_direction: "pull" as const,
              category: connCategory,
              color: connColor,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length > 0) {
          const { error: upsertErr } = await supabaseAdmin
            .from("calendar_events")
            .upsert(rows, { onConflict: "gcal_connection_id,google_event_id" });
          if (upsertErr) {
            console.error("calendar_events upsert failed", upsertErr);
            throw new Error(`Upsert failed: ${upsertErr.message}`);
          }
          for (const r of rows) fetchedIds.push(r.google_event_id);
          totalSynced += rows.length;
        }



        pageToken = body.nextPageToken;
      } while (pageToken);

      await supabaseAdmin
        .from("google_calendar_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    return { synced: totalSynced, pushed: totalPushed, connections: connections.length };
  });

/**
 * Delete a calendar event. If the event came from Google and the connection
 * allows write-back, also delete it on Google. Always records a tombstone so
 * the next sync does not re-import it.
 */
export const deleteCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("calendar_events")
      .select("id, user_id, gcal_connection_id, google_event_id")
      .eq("id", data.eventId)
      .maybeSingle();
    if (evErr) throw new Error(evErr.message);
    if (!ev || ev.user_id !== userId) throw new Error("Événement introuvable");

    // If linked to Google → try to delete remotely + tombstone
    if (ev.gcal_connection_id && ev.google_event_id) {
      const { data: conn } = await supabaseAdmin
        .from("google_calendar_connections")
        .select("*")
        .eq("id", ev.gcal_connection_id)
        .maybeSingle();

      if (conn) {
        // Tombstone first (idempotent) so even a failed remote delete won't re-sync
        await supabaseAdmin.from("deleted_calendar_events").upsert(
          {
            user_id: userId,
            gcal_connection_id: ev.gcal_connection_id,
            google_event_id: ev.google_event_id,
          },
          { onConflict: "gcal_connection_id,google_event_id" },
        );

        if (conn.sync_direction !== "pull") {
          let accessToken = conn.access_token;
          if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
            try {
              const refreshed = await refreshAccessToken(conn.refresh_token);
              accessToken = refreshed.accessToken;
              await supabaseAdmin
                .from("google_calendar_connections")
                .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
                .eq("id", conn.id);
            } catch (e) {
              console.warn("Token refresh failed before delete", e);
            }
          }
          const calendarId = encodeURIComponent(conn.calendar_id || "primary");
          const r = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(ev.google_event_id)}`,
            { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
          );
          // 404/410 = already gone, OK. Other errors → log, tombstone keeps it hidden.
          if (!r.ok && r.status !== 404 && r.status !== 410) {
            console.warn("Google delete failed", r.status, await r.text().catch(() => ""));
          }
        }
      }
    }

    const { error: delErr } = await supabaseAdmin
      .from("calendar_events")
      .delete()
      .eq("id", ev.id);
    if (delErr) throw new Error(delErr.message);

    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Multi-agenda: list / add / update connections                       */
/* ------------------------------------------------------------------ */

export const listGoogleCalendarConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { data, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("id,label,google_email,calendar_id,category,color,sync_direction,is_active,last_sync_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Fetch the list of calendars available in the Google account of an existing connection. */
export const listGoogleCalendarsForConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ connectionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: conn, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("*")
      .eq("id", data.connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !conn) throw new Error("Connexion introuvable");

    let accessToken = conn.access_token as string;
    if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      accessToken = refreshed.accessToken;
      await supabaseAdmin
        .from("google_calendar_connections")
        .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
        .eq("id", conn.id);
    }

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Google calendarList ${res.status}: ${t.slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      items?: { id: string; summary?: string; primary?: boolean; backgroundColor?: string }[];
    };
    return (body.items ?? []).map((c) => ({
      id: c.id,
      summary: c.summary ?? c.id,
      primary: !!c.primary,
      backgroundColor: c.backgroundColor ?? null,
    }));
  });

/** Create a second connection row reusing an existing refresh_token but targeting a different calendar_id. */
export const addGoogleCalendarFromExisting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sourceConnectionId: z.string().uuid(),
        calendarId: z.string().min(1).max(255),
        label: z.string().min(1).max(120),
        category: z.enum(["pro", "perso"]).default("perso"),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        syncDirection: z.enum(["pull", "push", "bidirectional"]).default("bidirectional"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: src, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("*")
      .eq("id", data.sourceConnectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !src) throw new Error("Connexion source introuvable");

    const { data: existing } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("calendar_id", data.calendarId)
      .maybeSingle();
    if (existing) throw new Error("Cet agenda est déjà connecté.");

    const color = data.color ?? (data.category === "perso" ? "#f97316" : "#6366f1");

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("google_calendar_connections")
      .insert({
        user_id: userId,
        label: data.label,
        google_email: src.google_email,
        access_token: src.access_token,
        refresh_token: src.refresh_token,
        expires_at: src.expires_at,
        calendar_id: data.calendarId,
        category: data.category,
        color,
        sync_direction: data.syncDirection,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { id: inserted.id };
  });

export const updateGoogleCalendarConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().min(1).max(120).optional(),
        category: z.enum(["pro", "perso"]).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        sync_direction: z.enum(["pull", "push", "bidirectional"]).optional(),
        is_active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { id, ...rest } = data;
    const patch = { ...rest, updated_at: new Date().toISOString() };
    const { error } = await supabaseAdmin
      .from("google_calendar_connections")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteGoogleCalendarConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { error } = await supabaseAdmin
      .from("google_calendar_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


