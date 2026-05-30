import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function html(message: string, ok: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<meta http-equiv="refresh" content="2;url=/calendar">
<style>body{font-family:system-ui;background:#0a0a0a;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{max-width:480px;padding:24px;border-radius:12px;background:#171717;text-align:center}h1{font-size:18px;margin:0 0 8px}p{opacity:.7;font-size:14px;margin:0}</style>
</head><body><div><h1>${ok ? "✅ Google Calendar connecté" : "❌ Échec de connexion"}</h1><p>${message}</p><p style="margin-top:12px">Redirection vers l'agenda…</p></div></body></html>`;
}

function page(message: string, ok: boolean, status = 200) {
  return new Response(html(message, ok), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");

        if (errorParam) return page(`Google a renvoyé: ${errorParam}`, false, 400);
        if (!code || !state) return page("Paramètres manquants.", false, 400);

        const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return page("Identifiants Google non configurés côté serveur.", false, 500);
        }

        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("oauth_states")
          .select("user_id,label,expires_at")
          .eq("state", state)
          .eq("provider", "google_calendar")
          .maybeSingle();

        if (stateErr || !stateRow) return page("Session OAuth invalide ou expirée.", false, 400);
        if (new Date(stateRow.expires_at) < new Date()) {
          await supabaseAdmin.from("oauth_states").delete().eq("state", state);
          return page("Session OAuth expirée. Réessayez.", false, 400);
        }

        const forwardedHost = request.headers.get("x-forwarded-host");
        const forwardedProto = request.headers.get("x-forwarded-proto");
        const origin = `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? url.host}`;
        const redirectUri = `${origin}/api/google-calendar/callback`;

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });

        const tokenBody = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok) {
          console.error("Google token exchange failed", tokenRes.status, tokenBody);
          return page(
            `Échec d'échange de code (${tokenRes.status}): ${tokenBody.error_description ?? tokenBody.error ?? "unknown"}`,
            false,
            502,
          );
        }

        const accessToken: string = tokenBody.access_token;
        const refreshToken: string | undefined = tokenBody.refresh_token;
        const expiresIn: number = tokenBody.expires_in ?? 3600;

        if (!accessToken || !refreshToken) {
          return page(
            "Réponse Google incomplète (pas de refresh_token). Révoquez l'accès dans votre compte Google puis reconnectez.",
            false,
            502,
          );
        }

        let googleEmail: string | null = null;
        try {
          const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { authorization: `Bearer ${accessToken}` },
          });
          if (ui.ok) {
            const u = await ui.json();
            googleEmail = u.email ?? null;
          }
        } catch {
          /* non-blocking */
        }

        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        const { error: upsertErr } = await supabaseAdmin
          .from("google_calendar_connections")
          .insert({
            user_id: stateRow.user_id,
            label: stateRow.label ?? "Google Calendar",
            google_email: googleEmail,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
          });

        if (upsertErr) {
          console.error("Failed to save gcal connection", upsertErr);
          return page(`Sauvegarde impossible: ${upsertErr.message}`, false, 500);
        }

        await supabaseAdmin.from("oauth_states").delete().eq("state", state);

        return page(
          googleEmail ? `Compte ${googleEmail} relié.` : "Compte Google relié.",
          true,
        );
      },
    },
  },
});
