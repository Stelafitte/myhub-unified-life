// Edge Function: send-imap
// Sends an email via SMTP using credentials stored on an IMAP account.
// Used for OVH-based accounts (CHU, EchoBordeaux, etc.)
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { account_id, to, cc, bcc, subject, text, html, in_reply_to, references, attachments } = body ?? {};
    if (!account_id || !to || !subject) {
      return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: account, error: accErr } = await admin.from("accounts").select("*").eq("id", account_id).eq("user_id", userId).single();
    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const c = account.credentials ?? {};
    const smtpHost = c.smtp_server || c.smtp_host;
    const smtpPort = c.smtp_port || 465;
    const username = c.username;
    const password = c.password;
    if (!smtpHost || !username || !password) {
      return new Response(JSON.stringify({ error: "SMTP credentials missing on account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: username, pass: password },
    });

    const mailAttachments = Array.isArray(attachments)
      ? attachments.map((a: any) => ({
          filename: a.filename,
          content: a.content_base64,
          encoding: "base64",
          contentType: a.mime_type,
        }))
      : undefined;

    const info = await transporter.sendMail({
      from: `"${account.name}" <${username}>`,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      text: text || undefined,
      html: html || undefined,
      inReplyTo: in_reply_to || undefined,
      references: references || undefined,
      attachments: mailAttachments,
    });

    return new Response(JSON.stringify({ ok: true, messageId: info.messageId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-imap] fail", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
