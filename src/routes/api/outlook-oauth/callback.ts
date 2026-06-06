import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PREVIEW_OAUTH_ORIGIN = "https://id-preview--723c3dcd-e4f6-4fec-98f4-4db15daebc63.lovable.app";

function getOAuthOrigin(origin: string): string {
  const host = new URL(origin).hostname;
  if (host.endsWith(".lovableproject.com")) return PREVIEW_OAUTH_ORIGIN;
  return origin;
}

function html(message: string, ok: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Outlook</title>
<meta http-equiv="refresh" content="6;url=/calendar?outlook_error=${ok ? "" : encodeURIComponent(message)}">
<style>body{font-family:system-ui;background:#0a0a0a;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:16px}div{max-width:560px;padding:28px;border-radius:14px;background:#171717;text-align:center}h1{font-size:18px;margin:0 0 10px}p{opacity:.75;font-size:14px;margin:0;line-height:1.5}</style>
</head><body><div><h1>${ok ? "&#9989; Outlook connect&eacute;" : "&#10060; &Eacute;chec"}</h1><p>${message}</p><p style="margin-top:14px;opacity:.5;font-size:12px">Redirection…</p></div></body></html>`;
}

function page(message: string, ok: boolean, status = 200) {
  return new Response(html(message, ok), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/outlook-oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");

        if (errorParam) return page(`Microsoft a refusé l'accès (${errorParam}).`, false, 400);
        if (!code || !state) return page("Paramètres manquants.", false, 400);

        const clientId = process.env.OUTLOOK_CLIENT_ID;
        const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
        if (!clientId || !clientSecret) return page("Identifiants Outlook non configurés.", false, 500);

        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("oauth_states")
          .select("user_id,label,expires_at")
          .eq("state", state)
          .eq("provider", "outlook_calendar")
          .maybeSingle();

        if (stateErr || !stateRow) return page("Session OAuth invalide ou expirée.", false, 400);
        if (new Date(stateRow.expires_at) < new Date()) {
          await supabaseAdmin.from("oauth_states").delete().eq("state", state);
          return page("Session OAuth expirée.", false, 400);
        }

        const forwardedHost = request.headers.get("x-forwarded-host");
        const forwardedProto = request.headers.get("x-forwarded-proto");
        const origin = getOAuthOrigin(
          `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? url.host}`,
        );
        const redirectUri = `${origin}/api/outlook-oauth/callback`;

        const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
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
          console.error("Outlook token exchange failed", tokenRes.status, tokenBody);
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
            "Réponse Microsoft incomplète (pas de refresh_token). Révoquez l'accès puis reconnectez.",
            false,
            502,
          );
        }

        // Get user email
        let outlookEmail: string | null = null;
        try {
          const me = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { authorization: `Bearer ${accessToken}` },
          });
          if (me.ok) {
            const u = await me.json();
            outlookEmail = u.mail ?? u.userPrincipalName ?? null;
          }
        } catch {
          /* non-blocking */
        }

        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        const { error: insertErr } = await supabaseAdmin
          .from("outlook_connections")
          .insert({
            user_id: stateRow.user_id,
            label: stateRow.label ?? "Outlook",
            outlook_email: outlookEmail,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
          });

        if (insertErr) {
          console.error("Failed to save outlook connection", insertErr);
          return page(`Sauvegarde impossible: ${insertErr.message}`, false, 500);
        }

        await supabaseAdmin.from("oauth_states").delete().eq("state", state);

        return page(outlookEmail ? `Compte ${outlookEmail} relié.` : "Compte Outlook relié.", true);
      },
    },
  },
});
