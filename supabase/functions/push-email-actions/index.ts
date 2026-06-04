// Edge Function: push-email-actions
// Reflects user actions performed in MyHub Pro back to the upstream provider
// (Gmail / Outlook via Lovable connector gateway, IMAP via raw TLS).
//
// Body (JSON):
//   { "email_id": "<uuid>", "action": "mark_read" | "mark_unread" | "trash" | "untrash", "account_id": "<uuid>" }
//
// Auth: requires the caller's Supabase JWT (verify_jwt = true). Tokens / passwords
// are never echoed in logs.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GMAIL_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY") ?? "";
const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY") ?? "";

const GMAIL_GW = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const OUTLOOK_GW = "https://connector-gateway.lovable.dev/microsoft_outlook";

type Action = "mark_read" | "mark_unread" | "trash" | "untrash";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail
// ─────────────────────────────────────────────────────────────────────────────
async function pushGmail(messageId: string, action: Action): Promise<void> {
  if (!LOVABLE_API_KEY || !GMAIL_KEY) throw new Error("gmail connector not configured");
  const headers = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GMAIL_KEY,
    "Content-Type": "application/json",
  };
  const base = `${GMAIL_GW}/users/me/messages/${encodeURIComponent(messageId)}`;
  let url = "";
  let body: string | null = null;
  switch (action) {
    case "mark_read":
      url = `${base}/modify`;
      body = JSON.stringify({ removeLabelIds: ["UNREAD"] });
      break;
    case "mark_unread":
      url = `${base}/modify`;
      body = JSON.stringify({ addLabelIds: ["UNREAD"] });
      break;
    case "trash":
      url = `${base}/trash`;
      break;
    case "untrash":
      url = `${base}/untrash`;
      break;
  }
  const r = await fetch(url, { method: "POST", headers, body });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`gmail ${action} ${r.status}: ${txt.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outlook (Microsoft Graph via gateway)
// ─────────────────────────────────────────────────────────────────────────────
async function pushOutlook(messageId: string, action: Action): Promise<void> {
  if (!LOVABLE_API_KEY || !OUTLOOK_KEY) throw new Error("outlook connector not configured");
  const headers = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": OUTLOOK_KEY,
    "Content-Type": "application/json",
  };
  const base = `${OUTLOOK_GW}/me/messages/${encodeURIComponent(messageId)}`;
  let url = "";
  let method: "PATCH" | "POST" = "PATCH";
  let body: string | null = null;
  switch (action) {
    case "mark_read":
      url = base;
      method = "PATCH";
      body = JSON.stringify({ isRead: true });
      break;
    case "mark_unread":
      url = base;
      method = "PATCH";
      body = JSON.stringify({ isRead: false });
      break;
    case "trash":
      url = `${base}/move`;
      method = "POST";
      body = JSON.stringify({ destinationId: "deleteditems" });
      break;
    case "untrash":
      url = `${base}/move`;
      method = "POST";
      body = JSON.stringify({ destinationId: "inbox" });
      break;
  }
  const r = await fetch(url, { method, headers, body });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`outlook ${action} ${r.status}: ${txt.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAP — minimal client for STORE / COPY / EXPUNGE on a single message
// ─────────────────────────────────────────────────────────────────────────────
function escapeImap(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

class MiniImap {
  private buffer = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private encoder = new TextEncoder();
  private tagCounter = 0;

  constructor(private conn: Deno.TlsConn) {
    this.reader = conn.readable.getReader();
    this.writer = conn.writable.getWriter();
  }

  close() {
    try { this.reader.releaseLock(); } catch { /* noop */ }
    try { this.writer.releaseLock(); } catch { /* noop */ }
    try { this.conn.close(); } catch { /* noop */ }
  }

  private async readMore(): Promise<void> {
    const { value, done } = await this.reader.read();
    if (done || !value) throw new Error("imap closed");
    const merged = new Uint8Array(this.buffer.length + value.length);
    merged.set(this.buffer);
    merged.set(value, this.buffer.length);
    this.buffer = merged;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf(0x0a);
      if (idx >= 0) {
        const line = new TextDecoder().decode(this.buffer.subarray(0, idx + 1));
        this.buffer = this.buffer.subarray(idx + 1);
        return line;
      }
      await this.readMore();
    }
  }

  async readGreeting(): Promise<void> {
    await this.readLine();
  }

  async cmd(command: string): Promise<{ ok: boolean; lines: string[] }> {
    const tag = `A${++this.tagCounter}`;
    await this.writer.write(this.encoder.encode(`${tag} ${command}\r\n`));
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      if (line.startsWith(`${tag} `)) {
        return { ok: /^A\d+\s+OK\b/i.test(line), lines };
      }
      lines.push(line);
    }
  }
}

async function findUidByMessageId(imap: MiniImap, messageId: string): Promise<number | null> {
  // Try with and without angle brackets — servers differ.
  const candidates = [
    messageId,
    messageId.startsWith("<") ? messageId.slice(1, -1) : `<${messageId}>`,
  ];
  for (const cand of candidates) {
    const r = await imap.cmd(`UID SEARCH HEADER Message-ID "${escapeImap(cand)}"`);
    if (!r.ok) continue;
    for (const ln of r.lines) {
      const m = ln.match(/\*\s+SEARCH\s+(.*)/i);
      if (m) {
        const nums = m[1].trim().split(/\s+/).filter(Boolean).map((s) => Number(s)).filter(Number.isFinite);
        if (nums.length > 0) return Math.max(...nums);
      }
    }
  }
  return null;
}

// Discover the Trash mailbox via LIST (RFC 6154 \Trash special-use, then common names).
async function findTrashMailbox(imap: MiniImap): Promise<string | null> {
  // Try special-use extension first.
  const r = await imap.cmd(`LIST (SPECIAL-USE) "" "*"`);
  if (r.ok) {
    for (const ln of r.lines) {
      if (/\\Trash\b/i.test(ln)) {
        // * LIST (\HasNoChildren \Trash) "/" "Corbeille"
        const m = ln.match(/"([^"]+)"\s*$/) || ln.match(/\s(\S+)\s*$/);
        if (m) return m[1];
      }
    }
  }
  // Fallback: LIST all and match common names.
  const r2 = await imap.cmd(`LIST "" "*"`);
  if (r2.ok) {
    const known = ["Trash", "INBOX.Trash", "Corbeille", "INBOX.Corbeille", "[Gmail]/Trash", "Deleted Items", "Deleted", "INBOX.Deleted", "INBOX.Deleted Messages"];
    for (const ln of r2.lines) {
      const m = ln.match(/"([^"]+)"\s*$/) || ln.match(/\s(\S+)\s*$/);
      if (!m) continue;
      const name = m[1];
      if (known.some((k) => k.toLowerCase() === name.toLowerCase())) return name;
    }
  }
  return null;
}

async function pushImap(account: any, messageId: string, action: Action): Promise<void> {
  const creds = account.credentials ?? {};
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) throw new Error("imap credentials missing");

  const conn = await Deno.connectTls({ hostname: host, port });
  const imap = new MiniImap(conn);
  try {
    await imap.readGreeting();
    const login = await imap.cmd(`LOGIN "${escapeImap(user)}" "${escapeImap(pass)}"`);
    if (!login.ok) throw new Error("LOGIN failed");

    if (action === "untrash") {
      // Source = Trash (discovered), target = INBOX
      const trashBox = (await findTrashMailbox(imap)) ?? "Trash";
      const sel = await imap.cmd(`SELECT "${escapeImap(trashBox)}"`);
      if (!sel.ok) throw new Error(`SELECT ${trashBox} failed`);
      const uid = await findUidByMessageId(imap, messageId);
      if (!uid) return;
      const cp = await imap.cmd(`UID COPY ${uid} INBOX`);
      if (!cp.ok) throw new Error("UID COPY failed");
      await imap.cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`);
      await imap.cmd("EXPUNGE");
    } else {
      const sel = await imap.cmd("SELECT INBOX");
      if (!sel.ok) throw new Error("SELECT INBOX failed");
      const uid = await findUidByMessageId(imap, messageId);
      if (!uid) return;

      if (action === "mark_read") {
        await imap.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`);
      } else if (action === "mark_unread") {
        await imap.cmd(`UID STORE ${uid} -FLAGS (\\Seen)`);
      } else if (action === "trash") {
        const trashBox = await findTrashMailbox(imap);
        const candidates = trashBox
          ? [trashBox]
          : ["Trash", "INBOX.Trash", "[Gmail]/Trash", "Corbeille", "INBOX.Corbeille", "Deleted", "Deleted Items", "INBOX.Deleted", "INBOX.Deleted Messages"];
        let copied = false;
        for (const box of candidates) {
          const cp = await imap.cmd(`UID COPY ${uid} "${escapeImap(box)}"`);
          if (cp.ok) { copied = true; break; }
        }
        if (!copied) throw new Error("UID COPY Trash failed (no compatible Trash mailbox found)");
        await imap.cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`);
        await imap.cmd("EXPUNGE");
      }
    }
    await imap.cmd("LOGOUT").catch(() => {});
  } finally {
    imap.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return jsonResponse({ error: "unauthorized" }, 401);
  const userId = userRes.user.id;

  let body: { email_id?: string; action?: Action; account_id?: string } = {};
  try { body = await req.json(); } catch { /* noop */ }
  const { email_id, action, account_id } = body;
  if (!email_id || !action || !account_id) {
    return jsonResponse({ error: "email_id, action and account_id required" }, 400);
  }
  if (!["mark_read", "mark_unread", "trash", "untrash"].includes(action)) {
    return jsonResponse({ error: "invalid action" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: account, error: accErr } = await admin
    .from("accounts")
    .select("id,user_id,type,name,credentials")
    .eq("id", account_id)
    .maybeSingle();
  if (accErr || !account) return jsonResponse({ error: "account not found" }, 404);
  if (account.user_id !== userId) return jsonResponse({ error: "forbidden" }, 403);

  const { data: email, error: emErr } = await admin
    .from("emails")
    .select("id,user_id,account_id,message_id")
    .eq("id", email_id)
    .maybeSingle();
  if (emErr || !email) return jsonResponse({ error: "email not found" }, 404);
  if (email.user_id !== userId) return jsonResponse({ error: "forbidden" }, 403);
  if (!email.message_id) return jsonResponse({ error: "missing provider message id" }, 422);

  try {
    if (account.type === "gmail") {
      await pushGmail(email.message_id, action);
    } else if (account.type === "outlook") {
      await pushOutlook(email.message_id, action);
    } else if (account.type === "imap") {
      await pushImap(account, email.message_id, action);
    } else {
      return jsonResponse({ error: `unsupported account type: ${account.type}` }, 422);
    }
    // Log w/o tokens — only metadata.
    console.log(`[push-email-actions] ok account=${account.type} action=${action}`);
    return jsonResponse({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[push-email-actions] fail account=${account.type} action=${action}: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 502);
  }
});
