import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "User.Read",
  "Calendars.ReadWrite",
  "Contacts.ReadWrite",
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

export const startOutlookOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      label: z.string().min(1).max(80).optional(),
      category: z.enum(["pro", "perso"]).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    if (!clientId) throw new Error("OUTLOOK_CLIENT_ID is not configured.");
    const { userId } = context as { userId: string };

    const state = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("oauth_states").insert({
      state,
      user_id: userId,
      provider: "outlook_calendar",
      label: data.label ?? `Outlook${data.category ? ` (${data.category})` : ""}`,
    });
    if (error) throw new Error(`Failed to create OAuth session: ${error.message}`);

    const redirectUri = `${getOrigin()}/api/outlook-oauth/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: SCOPES,
      prompt: "consent",
      state,
    });

    return {
      authorizationUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
      redirectUri,
      state,
    };
  });

export async function refreshOutlookToken(refreshToken: string) {
  const clientId = process.env.OUTLOOK_CLIENT_ID!;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET!;
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Outlook refresh failed (${res.status}): ${body.error_description ?? body.error ?? "unknown"}`);
  }
  return {
    accessToken: body.access_token as string,
    refreshToken: (body.refresh_token as string) ?? refreshToken,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function getValidOutlookToken(connectionId: string, userId: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("outlook_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !conn) throw new Error("Connection Outlook introuvable");

  let accessToken = conn.access_token as string;
  let refreshToken = conn.refresh_token as string;
  if (!conn.expires_at || new Date(conn.expires_at).getTime() <= Date.now() + 60_000) {
    const refreshed = await refreshOutlookToken(refreshToken);
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
    await supabaseAdmin
      .from("outlook_connections")
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: refreshed.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);
  }
  return { accessToken, connection: conn };
}

export const listOutlookConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { data, error } = await supabaseAdmin
      .from("outlook_connections")
      .select("id, label, outlook_email, category, sync_direction, is_active, last_sync_at, expires_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { connections: data ?? [] };
  });

export const deleteOutlookConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { error } = await supabaseAdmin
      .from("outlook_connections")
      .delete()
      .eq("id", data.connectionId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
