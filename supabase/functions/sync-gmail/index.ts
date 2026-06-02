// Edge Function: sync-gmail
// Uses the Lovable connector gateway to fetch Gmail messages and store them in `emails`.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMeetingLink } from "../_shared/meeting-link.ts";
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
const GMAIL_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gh() {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GMAIL_KEY,
  };
}

function b64urlDecode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseAddr(raw: string): { name: string | null; address: string | null } {
  if (!raw) return { name: null, address: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, address: m[2].trim() };
  return { name: null, address: raw.trim() };
}

type GmailAttachmentRef = { partId: string; filename: string; mimeType: string; attachmentId: string; size: number };

function extractParts(payload: any): { text: string; html: string; hasAttach: boolean; attachments: GmailAttachmentRef[] } {
  let text = "", html = "", hasAttach = false;
  const attachments: GmailAttachmentRef[] = [];
  function walk(p: any) {
    if (!p) return;
    const mt = (p.mimeType || "").toLowerCase();
    if (p.filename && p.body?.attachmentId) {
      hasAttach = true;
      attachments.push({
        partId: p.partId,
        filename: p.filename,
        mimeType: p.mimeType || "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size ?? 0,
      });
    }
    if (mt === "text/plain" && p.body?.data) text += b64urlDecode(p.body.data) + "\n";
    else if (mt === "text/html" && p.body?.data) html += b64urlDecode(p.body.data);
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  }
  walk(payload);
  return { text: text.slice(0, 100000), html: html.slice(0, 200000), hasAttach, attachments };
}

async function fetchGmailAttachment(messageId: string, ref: GmailAttachmentRef): Promise<AttachmentFile | null> {
  try {
    const r = await fetch(`${GATEWAY}/users/me/messages/${messageId}/attachments/${ref.attachmentId}`, { headers: gh() });
    if (!r.ok) {
      console.error(`[sync-gmail] attachment ${ref.filename} ${r.status}`);
      return null;
    }
    const j = await r.json();
    if (!j.data) return null;
    return { filename: ref.filename, mimeType: ref.mimeType, data: base64ToBytes(j.data, true) };
  } catch (e) {
    console.error(`[sync-gmail] attachment fetch error`, e);
    return null;
  }
}

async function syncGmail(account: any, admin: any): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // Premier sync : 30 jours en arrière. Sinon incrémental avec recouvrement de 24h
    // pour rattraper les mails arrivés en retard / clock skew / re-livraisons.
    const OVERLAP_MS = 24 * 3600 * 1000;
    const sinceIso = account.last_sync_at
      ? new Date(new Date(account.last_sync_at).getTime() - OVERLAP_MS).toISOString()
      : new Date(Date.now() - 30 * 86400000).toISOString();
    const afterTs = Math.floor(new Date(sinceIso).getTime() / 1000);
    const q = encodeURIComponent(`in:inbox after:${afterTs}`);
    const maxResults = account.last_sync_at ? 100 : 200;
    const listRes = await fetch(`${GATEWAY}/users/me/messages?maxResults=${maxResults}&q=${q}`, { headers: gh() });
    if (!listRes.ok) {
      const t = await listRes.text();
      return { ok: false, count: 0, error: `list ${listRes.status}: ${t.slice(0, 200)}` };
    }
    const list = await listRes.json();
    const msgs: Array<{ id: string }> = list.messages ?? [];
    let count = 0;

    // Tombstones — never resurrect emails the user already deleted.
    const { data: tombstones } = await admin
      .from("deleted_emails")
      .select("message_id")
      .eq("account_id", account.id);
    const deletedSet = new Set<string>((tombstones ?? []).map((r: any) => r.message_id));

    for (const { id } of msgs) {
      try {
        const mRes = await fetch(`${GATEWAY}/users/me/messages/${id}?format=full`, { headers: gh() });
        if (!mRes.ok) continue;
        const m = await mRes.json();
        const headers = m.payload?.headers ?? [];
        const from = parseAddr(header(headers, "From"));
        const to = parseAddr(header(headers, "To"));
        const subject = header(headers, "Subject") || null;
        const messageId = header(headers, "Message-ID") || m.id;
        if (deletedSet.has(messageId)) continue;

        const dateStr = header(headers, "Date");
        const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date(Number(m.internalDate || Date.now())).toISOString();
        const { text, html, hasAttach, attachments } = extractParts(m.payload);
        const isRead = !((m.labelIds ?? []).includes("UNREAD"));
        const isStarred = (m.labelIds ?? []).includes("STARRED");

        const { data: upserted, error: upErr } = await admin.from("emails").upsert({
          account_id: account.id,
          user_id: account.user_id,
          message_id: messageId,
          from_address: from.address,
          from_name: from.name,
          to_address: to.address,
          subject,
          body_text: text || null,
          body_html: html || null,
          meeting_link: extractMeetingLink(text, html),
          has_attachment: hasAttach,
          received_at: receivedAt,
          is_read: isRead,
          is_starred: isStarred,
          origin_tag: "gmail",
          thread_id: m.threadId || null,
        }, { onConflict: "account_id,message_id", ignoreDuplicates: false })
          .select("id")
          .maybeSingle();
        if (upErr) { console.error("[sync-gmail] upsert", upErr.message); continue; }
        count++;

        // Persist attachments
        if (upserted?.id && attachments.length > 0) {
          for (const ref of attachments) {
            const file = await fetchGmailAttachment(id, ref);
            if (file) {
              await persistAttachment(admin, account.user_id, account.id, upserted.id, false, file);
            }
          }
        }
      } catch (e) {
        console.error("[sync-gmail] msg fail", e);
      }
    }

    await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
    return { ok: true, count };
  } catch (e: any) {
    return { ok: false, count: 0, error: e?.message ?? String(e) };
  }
}

async function resolveGmailId(rfcMessageId: string): Promise<string | null> {
  if (!rfcMessageId) return null;
  // If it already looks like a Gmail internal id (hex only, no @), assume it's the provider id
  if (!rfcMessageId.includes("@") && /^[0-9a-fA-F]+$/.test(rfcMessageId)) return rfcMessageId;
  const q = encodeURIComponent(`rfc822msgid:${rfcMessageId.replace(/^<|>$/g, "")}`);
  const r = await fetch(`${GATEWAY}/users/me/messages?maxResults=1&q=${q}`, { headers: gh() });
  if (!r.ok) return null;
  const j = await r.json();
  return j.messages?.[0]?.id ?? null;
}

async function pushGmailAction(
  admin: any,
  action: "mark_read" | "mark_unread" | "trash",
  email: { message_id: string | null },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!email.message_id) return { ok: false, error: "missing message_id" };
  const providerId = await resolveGmailId(email.message_id);
  if (!providerId) return { ok: false, error: "gmail message not found" };
  if (action === "trash") {
    const r = await fetch(`${GATEWAY}/users/me/messages/${providerId}/trash`, { method: "POST", headers: gh() });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    return { ok: true };
  }
  const body = action === "mark_read"
    ? { removeLabelIds: ["UNREAD"] }
    : { addLabelIds: ["UNREAD"] };
  const r = await fetch(`${GATEWAY}/users/me/messages/${providerId}/modify`, {
    method: "POST",
    headers: { ...gh(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
    if (!GMAIL_KEY) throw new Error("GOOGLE_MAIL_API_KEY missing — connector not linked");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: {
      account_id?: string;
      test?: boolean;
      force_full?: boolean;
      action?: "mark_read" | "mark_unread" | "trash";
      email_id?: string;
      message_id?: string;
    } = {};
    try { body = await req.json(); } catch { /* empty */ }

    // Quick connection test
    if (body.test) {
      const r = await fetch(`${GATEWAY}/users/me/profile`, { headers: gh() });
      const data = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: r.ok, status: r.status, profile: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bidirectional action push (read / unread / trash)
    if (body.action) {
      let email: { message_id: string | null; account_id: string } | null = null;
      if (body.email_id) {
        const { data } = await admin.from("emails").select("message_id, account_id").eq("id", body.email_id).maybeSingle();
        email = data as any;
      } else if (body.message_id && body.account_id) {
        email = { message_id: body.message_id, account_id: body.account_id };
      }
      if (!email) {
        return new Response(JSON.stringify({ ok: false, error: "email not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await pushGmailAction(admin, body.action, email);
      console.log(`[sync-gmail] action=${body.action} email_id=${body.email_id} result=`, result);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ") && authHeader !== `Bearer ${ANON}`) {
      const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }

    let q = admin.from("accounts").select("*").eq("is_active", true).eq("type", "gmail");
    if (userId) q = q.eq("user_id", userId);
    if (body.account_id) q = q.eq("id", body.account_id);

    const { data: accounts, error } = await q;
    if (error) throw error;

    // force_full: re-sync depuis 30j (récupère bodies/PJ sur mails déjà importés)
    if (body.force_full && accounts) {
      for (const acc of accounts) acc.last_sync_at = null;
    }

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      const r = await syncGmail(acc, admin);
      console.log(`[sync-gmail] account=${acc.name} result=`, r);
      results.push({ account_id: acc.id, name: acc.name, ...r });
    }

    return new Response(
      JSON.stringify({ ok: true, accounts: results.length, synced: results.reduce((s, r) => s + (r.count ?? 0), 0), results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[sync-gmail] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
