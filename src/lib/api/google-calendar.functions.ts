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
