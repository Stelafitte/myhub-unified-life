// Edge Function: fetch-email-attachments
// Re-fetches attachments for a single email (gmail/outlook) and persists them
// into the documents table + storage bucket. Useful when initial sync didn't
// capture them.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { persistAttachment, base64ToBytes, type AttachmentFile } from "../_shared/persist-attachment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GMAIL_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY") || "";
const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY") || "";
const GMAIL_GW = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const OUTLOOK_GW = "https://connector-gateway.lovable.dev/microsoft_outlook";

function gh(key: string) {
  return { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": key };
}

function stripBrackets(id: string): string {
  return id.replace(/^<|>$/g, "");
}

async function fetchGmail(admin: any, email: any, account: any): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!GMAIL_KEY) return { ok: false, count: 0, error: "Connecteur Gmail non configuré" };
  const rfcId = stripBrackets(email.message_id || "");
  if (!rfcId) return { ok: false, count: 0, error: "message_id manquant" };
  // Find gmail internal id via search
  const q = encodeURIComponent(`rfc822msgid:${rfcId}`);
  const sRes = await fetch(`${GMAIL_GW}/users/me/messages?q=${q}`, { headers: gh(GMAIL_KEY) });
  if (!sRes.ok) return { ok: false, count: 0, error: `gmail search ${sRes.status}` };
  const sJson = await sRes.json();
  const gid = sJson.messages?.[0]?.id;
  if (!gid) return { ok: false, count: 0, error: "Email introuvable côté Gmail" };

  const mRes = await fetch(`${GMAIL_GW}/users/me/messages/${gid}?format=full`, { headers: gh(GMAIL_KEY) });
  if (!mRes.ok) return { ok: false, count: 0, error: `gmail fetch ${mRes.status}` };
  const m = await mRes.json();

  const refs: Array<{ filename: string; mimeType: string; attachmentId: string }> = [];
  function walk(p: any) {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      refs.push({
        filename: p.filename,
        mimeType: p.mimeType || "application/octet-stream",
        attachmentId: p.body.attachmentId,
      });
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  }
  walk(m.payload);

  let count = 0;
  for (const ref of refs) {
    try {
      const r = await fetch(`${GMAIL_GW}/users/me/messages/${gid}/attachments/${ref.attachmentId}`, { headers: gh(GMAIL_KEY) });
      if (!r.ok) continue;
      const j = await r.json();
      if (!j.data) continue;
      const file: AttachmentFile = { filename: ref.filename, mimeType: ref.mimeType, data: base64ToBytes(j.data, true) };
      const res = await persistAttachment(admin, account.user_id, account.id, email.id, !!email.is_sensitive, file);
      if (res.stored) count++;
    } catch (e) {
      console.error("[fetch-attachments] gmail att", e);
    }
  }
  if (refs.length > 0) await admin.from("emails").update({ has_attachment: true }).eq("id", email.id);
  return { ok: true, count };
}

async function fetchOutlook(admin: any, email: any, account: any): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!OUTLOOK_KEY) return { ok: false, count: 0, error: "Connecteur Outlook non configuré" };
  const rfcId = email.message_id || "";
  if (!rfcId) return { ok: false, count: 0, error: "message_id manquant" };
  const filter = encodeURIComponent(`internetMessageId eq '${rfcId.replace(/'/g, "''")}'`);
  const sRes = await fetch(`${OUTLOOK_GW}/me/messages?$top=1&$select=id,hasAttachments&$filter=${filter}`, { headers: gh(OUTLOOK_KEY) });
  if (!sRes.ok) return { ok: false, count: 0, error: `outlook search ${sRes.status}` };
  const sJson = await sRes.json();
  const oid = sJson.value?.[0]?.id;
  if (!oid) return { ok: false, count: 0, error: "Email introuvable côté Outlook" };

  const aRes = await fetch(`${OUTLOOK_GW}/me/messages/${oid}/attachments`, { headers: gh(OUTLOOK_KEY) });
  if (!aRes.ok) return { ok: false, count: 0, error: `outlook att ${aRes.status}` };
  const aJson = await aRes.json();
  const items: any[] = aJson.value ?? [];
  let count = 0;
  for (const att of items) {
    if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if (!att.contentBytes) continue;
    const file: AttachmentFile = {
      filename: att.name || "fichier",
      mimeType: att.contentType || "application/octet-stream",
      data: base64ToBytes(att.contentBytes, false),
    };
    const res = await persistAttachment(admin, account.user_id, account.id, email.id, !!email.is_sensitive, file);
    if (res.stored) count++;
  }
  if (items.length > 0) await admin.from("emails").update({ has_attachment: true }).eq("id", email.id);
  return { ok: true, count };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({})) as { email_id?: string };
    if (!body.email_id) {
      return new Response(JSON.stringify({ ok: false, error: "email_id requis" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: email, error: eErr } = await admin
      .from("emails")
      .select("id, account_id, user_id, message_id, is_sensitive")
      .eq("id", body.email_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (eErr || !email) {
      return new Response(JSON.stringify({ ok: false, error: "Email introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: account, error: aErr } = await admin
      .from("accounts").select("*").eq("id", email.account_id).maybeSingle();
    if (aErr || !account) {
      return new Response(JSON.stringify({ ok: false, error: "Compte introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let result: { ok: boolean; count: number; error?: string };
    if (account.type === "gmail") result = await fetchGmail(admin, email, account);
    else if (account.type === "outlook") result = await fetchOutlook(admin, email, account);
    else result = { ok: false, count: 0, error: `Type non supporté: ${account.type}` };

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[fetch-email-attachments] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
