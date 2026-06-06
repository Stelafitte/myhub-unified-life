import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * - GET  : verification handshake (hub.mode=subscribe, hub.verify_token, hub.challenge).
 *          We accept the request if the provided token matches ANY active
 *          `wa_business_connections.webhook_verify_token`.
 * - POST : signed event payload. The X-Hub-Signature-256 header MUST match
 *          `sha256=HMAC_SHA256(app_secret, raw_body)`. The app secret is
 *          provided via env var WHATSAPP_APP_SECRET (Meta App → Settings → Basic).
 *
 * Endpoint is intentionally public (no Supabase auth) — security relies on
 * the signed payload + the verify token. We never log tokens nor payload
 * bodies in clear.
 */
export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode !== "subscribe" || !token || !challenge) {
          return new Response("Bad Request", { status: 400 });
        }

        const { data, error } = await supabaseAdmin
          .from("wa_business_connections")
          .select("id")
          .eq("webhook_verify_token", token)
          .eq("is_active", true)
          .limit(1);

        if (error || !data || data.length === 0) {
          return new Response("Forbidden", { status: 403 });
        }

        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request }) => {
        const appSecret = process.env.WHATSAPP_APP_SECRET;
        if (!appSecret) {
          return new Response("Server not configured", { status: 500 });
        }

        const signature = request.headers.get("x-hub-signature-256");
        const raw = await request.text();

        if (!signature || !signature.startsWith("sha256=")) {
          return new Response("Missing signature", { status: 401 });
        }

        const expected = createHmac("sha256", appSecret).update(raw).digest("hex");
        const provided = signature.slice("sha256=".length);

        let valid = false;
        try {
          const a = Buffer.from(provided, "hex");
          const b = Buffer.from(expected, "hex");
          valid = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          valid = false;
        }
        if (!valid) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: WaWebhookPayload;
        try {
          payload = JSON.parse(raw) as WaWebhookPayload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Meta retries on non-2xx; process best-effort and always return 200.
        try {
          await processWaPayload(payload);
        } catch (e) {
          console.error("[wa-webhook] processing error", e instanceof Error ? e.message : e);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

// ---------- Types ----------
type WaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string; // WABA id
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string };
          audio?: { id?: string; mime_type?: string };
          video?: { id?: string; mime_type?: string };
          document?: { id?: string; mime_type?: string; filename?: string };
        }>;
        statuses?: Array<{ id?: string; status?: string }>;
      };
    }>;
  }>;
};

// ---------- Handlers ----------
async function processWaPayload(payload: WaWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value || change.field !== "messages") continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: conn } = await supabaseAdmin
        .from("wa_business_connections")
        .select("id,user_id,is_active")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!conn || !conn.is_active) continue;

      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;

        const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
        const body =
          m.text?.body ??
          (m.image ? "[image]" : null) ??
          (m.audio ? "[audio]" : null) ??
          (m.video ? "[video]" : null) ??
          (m.document ? `[document] ${m.document.filename ?? ""}` : null) ??
          "";

        const mediaMime =
          m.image?.mime_type ?? m.audio?.mime_type ?? m.video?.mime_type ?? m.document?.mime_type ?? null;

        await supabaseAdmin
          .from("wa_messages")
          .upsert(
            {
              connection_id: conn.id,
              user_id: conn.user_id,
              wa_message_id: m.id,
              from_number: m.from,
              from_name: value.contacts?.[0]?.profile?.name ?? null,
              is_from_me: false,
              type: m.type ?? "text",
              content: body,
              media_mime_type: mediaMime,
              timestamp: ts,
            },
            { onConflict: "wa_message_id" },
          );
      }
    }
  }
}
