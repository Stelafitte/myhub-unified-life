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

        for (const ev of items) {
          if (ev.status === "cancelled") continue;
          const startStr = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
          const endStr = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
          if (!startStr || !endStr) continue;
          const isAllDay = !!ev.start?.date && !ev.start?.dateTime;

          const row = {
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
          };

          // Upsert by (gcal_connection_id, google_event_id)
          const { data: existing } = await supabaseAdmin
            .from("calendar_events")
            .select("id")
            .eq("gcal_connection_id", conn.id)
            .eq("google_event_id", ev.id)
            .maybeSingle();

          if (existing) {
            await supabaseAdmin.from("calendar_events").update(row).eq("id", existing.id);
          } else {
            await supabaseAdmin.from("calendar_events").insert(row);
          }
          fetchedIds.push(ev.id);
          totalSynced++;
        }

        pageToken = body.nextPageToken;
      } while (pageToken);

      await supabaseAdmin
        .from("google_calendar_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    return { synced: totalSynced, connections: connections.length };
  });
