import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH_VERSION = "v20.0";

/** Return WA credentials stored as backend secrets, to pre-fill the form. */
export const getWaSecretsDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    const wa_business_account_id = process.env.WHATSAPP_WABA_ID ?? "";
    const access_token = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
    let phone_number = "";
    let display_name = "";
    if (phone_number_id && access_token) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name`,
          { headers: { Authorization: `Bearer ${access_token}` } },
        );
        if (res.ok) {
          const b = await res.json();
          phone_number = b.display_phone_number ?? "";
          display_name = b.verified_name ?? "";
        }
      } catch {
        /* ignore */
      }
    }
    return {
      has_secrets: !!(phone_number_id && access_token && wa_business_account_id),
      phone_number_id,
      wa_business_account_id,
      access_token,
      phone_number,
      display_name,
    };
  });

/** List WA Business connections for the current user. */
export const listWaConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("wa_business_connections")
      .select("id,phone_number_id,wa_business_account_id,phone_number,display_name,is_active,last_sync_at,webhook_verify_token,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Test a WA Cloud API connection by hitting the phone_number_id endpoint. */
export const testWaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone_number_id: z.string().min(1).max(64),
        access_token: z.string().min(10).max(4096),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(data.phone_number_id)}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${data.access_token}` } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.error?.message ?? `HTTP ${res.status}`;
        return { ok: false, error: msg };
      }
      return {
        ok: true,
        phone_number: body.display_phone_number ?? null,
        display_name: body.verified_name ?? null,
        quality_rating: body.quality_rating ?? null,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  });

/** Create or update a WA Business connection. */
export const saveWaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        phone_number_id: z.string().min(1).max(64),
        wa_business_account_id: z.string().min(1).max(64),
        access_token: z.string().min(10).max(4096),
        phone_number: z.string().min(1).max(64),
        display_name: z.string().max(255).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Test first
    const test = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(data.phone_number_id)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${data.access_token}` } },
    );
    if (!test.ok) {
      const body = await test.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `Connexion WhatsApp invalide (HTTP ${test.status})`);
    }

    const verify_token = crypto.randomUUID().replace(/-/g, "");
    const payload = {
      user_id: userId,
      phone_number_id: data.phone_number_id,
      wa_business_account_id: data.wa_business_account_id,
      access_token: data.access_token,
      phone_number: data.phone_number,
      display_name: data.display_name ?? null,
      is_active: true,
    };

    if (data.id) {
      const { error } = await supabase
        .from("wa_business_connections")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("wa_business_connections")
      .insert({ ...payload, webhook_verify_token: verify_token })
      .select("id,webhook_verify_token")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id, webhook_verify_token: inserted.webhook_verify_token };
  });

/** Toggle active state. */
export const setWaConnectionActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("wa_business_connections")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Delete a connection. */
export const deleteWaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("wa_business_connections")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Build the webhook setup info (URL + verify token) to paste in Meta dashboard. */
export const getWaWebhookSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: conn, error } = await supabase
      .from("wa_business_connections")
      .select("id,webhook_verify_token")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    let token = conn.webhook_verify_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      const { error: upErr } = await supabase
        .from("wa_business_connections")
        .update({ webhook_verify_token: token })
        .eq("id", data.id);
      if (upErr) throw new Error(upErr.message);
    }

    return {
      webhook_url: `/api/public/whatsapp/webhook`,
      verify_token: token,
      subscribed_fields: ["messages", "message_template_status_update"],
    };
  });

/** Send an outbound WhatsApp text message via Meta Cloud API. */
export const sendWaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        connection_id: z.string().uuid(),
        to: z.string().min(5).max(32), // E.164 without +, ex: 33612345678
        body: z.string().min(1).max(4096),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conn, error: connErr } = await supabase
      .from("wa_business_connections")
      .select("id,phone_number_id,access_token,is_active")
      .eq("id", data.connection_id)
      .maybeSingle();
    if (connErr) throw new Error(connErr.message);
    if (!conn) throw new Error("Connexion introuvable");
    if (!conn.is_active) throw new Error("Connexion inactive");

    const to = data.to.replace(/[^\d]/g, "");

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(conn.phone_number_id)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: data.body },
        }),
      },
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Envoi WhatsApp échoué: ${msg}`);
    }

    const wa_message_id: string | undefined = json?.messages?.[0]?.id;
    if (wa_message_id) {
      await supabase.from("wa_messages").insert({
        connection_id: conn.id,
        user_id: userId,
        wa_message_id,
        from_number: to,
        is_from_me: true,
        type: "text",
        content: data.body,
        status: "sent",
        timestamp: new Date().toISOString(),
      });
    }

    return { ok: true, wa_message_id: wa_message_id ?? null };
  });

/** List recent WhatsApp messages for a connection (in + out). */
export const listWaMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        connection_id: z.string().uuid(),
        peer_number: z.string().min(3).max(32).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("wa_messages")
      .select("id,wa_message_id,from_number,from_name,is_from_me,type,content,media_mime_type,status,timestamp,ai_category,ai_action_suggested")
      .eq("connection_id", data.connection_id)
      .order("timestamp", { ascending: false })
      .limit(data.limit);
    if (data.peer_number) q = q.eq("from_number", data.peer_number.replace(/[^\d]/g, ""));
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
