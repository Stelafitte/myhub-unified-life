// Edge Function: sync-imap
// Client IMAP minimal natif Deno (TLS brut). Compatible Supabase Edge Runtime.
// Fetch full RFC822 message + parse multipart MIME (body text, HTML, attachments).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectSensitive } from "./sensitive-detection.ts";
import { extractMeetingLink } from "../_shared/meeting-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

type EmailOrigin = "chu" | "univ" | "gmail" | "outlook" | "imap";

function detectOrigin(toAddress: string | null, accountEmail?: string | null): EmailOrigin {
  const to = (toAddress ?? "").toLowerCase();
  const acc = (accountEmail ?? "").toLowerCase();
  if (to.includes("@myhub-pro.fr") && to.startsWith("chu@")) return "chu";
  if (to.includes("@chu-bordeaux.fr")) return "chu";
  if (to.includes("univ") || to.includes("@etu.") || to.includes("@u-")) return "univ";
  if (to.includes("@gmail.")) return "gmail";
  if (to.includes("@outlook.") || to.includes("@hotmail.") || to.includes("@live.")) return "outlook";
  if (acc.includes("@echobordeaux.com")) return "imap"; // Echo Bordeaux
  if (acc.includes("@myhub-pro.fr")) return "chu";
  if (acc.includes("@u-bordeaux.fr")) return "univ";
  return "imap";
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal IMAP client (Deno TLS)
// ─────────────────────────────────────────────────────────────────────────────
class Imap {
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
    if (done || !value) throw new Error("IMAP connection closed");
    const merged = new Uint8Array(this.buffer.length + value.length);
    merged.set(this.buffer);
    merged.set(value, this.buffer.length);
    this.buffer = merged;
  }

  private findCRLF(): number {
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) return i;
    }
    return -1;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.findCRLF();
      if (idx >= 0) {
        const line = new TextDecoder("utf-8", { fatal: false }).decode(this.buffer.subarray(0, idx));
        this.buffer = this.buffer.subarray(idx + 2);
        return line;
      }
      await this.readMore();
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    while (this.buffer.length < n) await this.readMore();
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  async readGreeting(): Promise<string> {
    return await this.readLine();
  }

  async cmd(command: string): Promise<{ ok: boolean; rawText: string; literals: Uint8Array[]; statusLine: string }> {
    this.tagCounter++;
    const tag = "A" + this.tagCounter.toString().padStart(4, "0");
    await this.writer.write(this.encoder.encode(`${tag} ${command}\r\n`));

    let rawText = "";
    const literals: Uint8Array[] = [];
    while (true) {
      const line = await this.readLine();
      const litMatch = line.match(/\{(\d+)\}$/);
      if (litMatch) {
        const n = parseInt(litMatch[1]);
        rawText += line + "\r\n";
        const data = await this.readBytes(n);
        literals.push(data);
        continue;
      }
      if (line.startsWith(tag + " ")) {
        const status = line.substring(tag.length + 1).split(" ")[0];
        return { ok: status === "OK", rawText, literals, statusLine: line };
      }
      rawText += line + "\r\n";
    }
  }
}

function escapeArg(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatImapDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH response parser
// ─────────────────────────────────────────────────────────────────────────────
type FetchMsg = { uid: number; flags: string[]; raw: Uint8Array };

function parseFetchResponse(rawText: string, literals: Uint8Array[]): FetchMsg[] {
  const out: FetchMsg[] = [];
  const fetchRe = /\* (\d+) FETCH \(/g;
  const matches: { start: number }[] = [];
  let fm;
  while ((fm = fetchRe.exec(rawText)) !== null) matches.push({ start: fm.index });

  let litIdx = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : rawText.length;
    const chunk = rawText.substring(start, end);

    const uidM = chunk.match(/UID (\d+)/);
    const flagsM = chunk.match(/FLAGS \(([^)]*)\)/);
    const uid = uidM ? parseInt(uidM[1]) : 0;
    const flags = flagsM ? flagsM[1].split(/\s+/).filter(Boolean) : [];

    // Count literals in this chunk: each {N} consumes one literal
    let raw = new Uint8Array(0);
    const literalCount = (chunk.match(/\{\d+\}/g) || []).length;
    for (let k = 0; k < literalCount; k++) {
      const lit = literals[litIdx++];
      if (!lit) continue;
      // Last literal is the body
      if (k === literalCount - 1) raw = lit;
    }
    out.push({ uid, flags, raw });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME parsing
// ─────────────────────────────────────────────────────────────────────────────
function decodeMimeWord(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === "B") {
        const bytes = Uint8Array.from(atob(data.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else {
        const bytes: number[] = [];
        let i = 0;
        const t = data.replace(/_/g, " ");
        while (i < t.length) {
          if (t[i] === "=" && i + 2 < t.length) {
            bytes.push(parseInt(t.substring(i + 1, i + 3), 16));
            i += 3;
          } else {
            bytes.push(t.charCodeAt(i));
            i++;
          }
        }
        return new TextDecoder(charset).decode(new Uint8Array(bytes));
      }
    } catch {
      return data;
    }
  });
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const bytes: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "=" && i + 2 < s.length) {
      const next2 = s.substring(i + 1, i + 3);
      if (next2 === "\r\n" || next2[0] === "\n") {
        i += next2 === "\r\n" ? 3 : 2;
        continue;
      }
      const code = parseInt(next2, 16);
      if (!isNaN(code)) { bytes.push(code); i += 3; continue; }
    }
    bytes.push(s.charCodeAt(i));
    i++;
  }
  return new Uint8Array(bytes);
}

function decodeBase64(s: string): Uint8Array {
  try {
    const clean = s.replace(/\s+/g, "");
    const bin = atob(clean);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch {
    return new Uint8Array(0);
  }
}

type MimeHeaders = Record<string, string>;

function splitRawMime(raw: Uint8Array): { headers: MimeHeaders; body: Uint8Array } {
  // Find CRLF CRLF or LF LF
  for (let i = 0; i < raw.length - 3; i++) {
    if (raw[i] === 0x0d && raw[i + 1] === 0x0a && raw[i + 2] === 0x0d && raw[i + 3] === 0x0a) {
      const h = new TextDecoder("utf-8", { fatal: false }).decode(raw.subarray(0, i));
      return { headers: parseHeaderBlock(h), body: raw.subarray(i + 4) };
    }
  }
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] === 0x0a && raw[i + 1] === 0x0a) {
      const h = new TextDecoder("utf-8", { fatal: false }).decode(raw.subarray(0, i));
      return { headers: parseHeaderBlock(h), body: raw.subarray(i + 2) };
    }
  }
  return { headers: {}, body: raw };
}

function parseHeaderBlock(text: string): MimeHeaders {
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  const out: MimeHeaders = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.substring(0, i).trim().toLowerCase();
    const v = line.substring(i + 1).trim();
    if (!out[k]) out[k] = v;
  }
  return out;
}

function parseContentType(v: string): { type: string; params: Record<string, string> } {
  const [main, ...rest] = v.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.substring(0, eq).trim().toLowerCase();
    let val = p.substring(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[k] = val;
  }
  return { type: (main || "").trim().toLowerCase(), params };
}

function indicesOf(haystack: Uint8Array, needle: Uint8Array): number[] {
  const out: number[] = [];
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    out.push(i);
  }
  return out;
}

type AttachmentFile = { filename: string; mimeType: string; data: Uint8Array };
type ParsedPart = { textPlain: string; textHtml: string; attachments: number; files: AttachmentFile[] };

function decodePartBody(body: Uint8Array, encoding: string, charset: string): string {
  const enc = (encoding || "7bit").toLowerCase();
  let bytes: Uint8Array;
  if (enc === "base64") {
    bytes = decodeBase64(new TextDecoder("ascii").decode(body));
  } else if (enc === "quoted-printable") {
    bytes = decodeQuotedPrintable(new TextDecoder("ascii", { fatal: false }).decode(body));
  } else {
    bytes = body;
  }
  try { return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes); }
  catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
}

function decodePartBytes(body: Uint8Array, encoding: string): Uint8Array {
  const enc = (encoding || "7bit").toLowerCase();
  if (enc === "base64") return decodeBase64(new TextDecoder("ascii").decode(body));
  if (enc === "quoted-printable") return decodeQuotedPrintable(new TextDecoder("ascii", { fatal: false }).decode(body));
  return body;
}

function extractFilename(headers: MimeHeaders, ctParams: Record<string, string>): string | null {
  const disp = headers["content-disposition"] || "";
  const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
  if (m) { try { return decodeURIComponent(decodeMimeWord(m[1])); } catch { return decodeMimeWord(m[1]); } }
  if (ctParams["name"]) return decodeMimeWord(ctParams["name"]);
  if (ctParams["filename"]) return decodeMimeWord(ctParams["filename"]);
  return null;
}

function walkMime(raw: Uint8Array, out: ParsedPart) {
  const { headers, body } = splitRawMime(raw);
  const ct = parseContentType(headers["content-type"] || "text/plain; charset=utf-8");
  const disp = (headers["content-disposition"] || "").toLowerCase();
  const enc = headers["content-transfer-encoding"] || "7bit";

  if (ct.type.startsWith("multipart/")) {
    const boundary = ct.params["boundary"];
    if (!boundary) return;
    const enc8 = new TextEncoder();
    const delim = enc8.encode(`--${boundary}`);
    const positions = indicesOf(body, delim);
    for (let i = 0; i < positions.length - 1; i++) {
      let start = positions[i] + delim.length;
      if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
      else if (body[start] === 0x0a) start += 1;
      let end = positions[i + 1];
      if (end >= 2 && body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
      else if (end >= 1 && body[end - 1] === 0x0a) end -= 1;
      if (end > start) walkMime(body.subarray(start, end), out);
    }
    return;
  }

  const filename = extractFilename(headers, ct.params);
  const isAttachment = disp.includes("attachment") || !!filename;
  if (isAttachment) {
    out.attachments++;
    const data = decodePartBytes(body, enc);
    if (data.length > 0 && data.length <= 10 * 1024 * 1024) {
      out.files.push({
        filename: filename || `attachment-${out.attachments}`,
        mimeType: ct.type || "application/octet-stream",
        data,
      });
    }
    return;
  }

  if (ct.type === "text/plain" && !out.textPlain) {
    out.textPlain = decodePartBody(body, enc, ct.params["charset"] || "utf-8");
  } else if (ct.type === "text/html" && !out.textHtml) {
    out.textHtml = decodePartBody(body, enc, ct.params["charset"] || "utf-8");
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

async function persistAttachment(
  admin: any,
  userId: string,
  accountId: string,
  emailId: string,
  emailSensitive: boolean,
  file: AttachmentFile,
): Promise<void> {
  try {
    const checksum = await sha256Hex(file.data);
    const { data: existing } = await admin
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("checksum", checksum)
      .maybeSingle();
    if (existing) return;

    const docId = crypto.randomUUID();
    const safe = safeFilename(file.filename);
    const path = `${userId}/email/${docId}-${safe}`;

    const { error: upErr } = await admin.storage.from("documents").upload(path, file.data, {
      contentType: file.mimeType,
      upsert: false,
    });
    if (upErr) { console.error(`[sync-imap] storage upload failed`, upErr); return; }

    const { error: insErr } = await admin.from("documents").insert({
      id: docId,
      user_id: userId,
      account_id: accountId,
      source_type: "email",
      source_id: emailId,
      filename: safe,
      original_filename: file.filename,
      mime_type: file.mimeType,
      file_size: file.data.length,
      storage_path: path,
      checksum,
      tags: emailSensitive ? ["email", "sensible"] : ["email"],
      is_sensitive: emailSensitive,
      sensitive_reason: emailSensitive ? "Email source classé sensible (HDS)" : null,
      local_only: false,
    });
    if (insErr) {
      console.error(`[sync-imap] document insert failed`, insErr);
      await admin.storage.from("documents").remove([path]).catch(() => {});
    }
  } catch (e) {
    console.error(`[sync-imap] persistAttachment error`, e);
  }
}

function parseAddress(s: string): { address: string | null; name: string | null } {
  if (!s) return { address: null, name: null };
  const decoded = decodeMimeWord(s);
  const m = decoded.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { address: m[2].trim(), name: (m[1] || "").trim() || null };
  return { address: decoded.trim(), name: null };
}

function extractSearchUids(rawText: string): number[] {
  const sm = rawText.match(/\* SEARCH([0-9 \r\n]*)/);
  if (!sm) return [];
  return sm[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n));
}

async function openInbox(account: any): Promise<Imap> {
  const creds = account.credentials ?? {};
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) throw new Error("missing credentials");
  const conn = await Deno.connectTls({ hostname: host, port });
  const imap = new Imap(conn);
  await imap.readGreeting();
  const loginRes = await imap.cmd(`LOGIN "${escapeArg(user)}" "${escapeArg(pass)}"`);
  if (!loginRes.ok) throw new Error(`LOGIN failed: ${loginRes.statusLine}`);
  const selRes = await imap.cmd("SELECT INBOX");
  if (!selRes.ok) throw new Error(`SELECT failed: ${selRes.statusLine}`);
  return imap;
}

async function resolveImapUid(imap: Imap, accountId: string, messageId: string | null): Promise<number | null> {
  if (!messageId) return null;
  if (messageId.startsWith(`${accountId}-`)) {
    const uid = Number(messageId.slice(accountId.length + 1));
    if (Number.isFinite(uid) && uid > 0) return uid;
  }
  const variants = Array.from(
    new Set([messageId, messageId.replace(/^<|>$/g, ""), `<${messageId.replace(/^<|>$/g, "")}>`]),
  );
  for (const candidate of variants) {
    const res = await imap.cmd(`UID SEARCH HEADER Message-ID "${escapeArg(candidate)}"`);
    if (!res.ok) continue;
    const uid = extractSearchUids(res.rawText).at(-1);
    if (uid) return uid;
  }
  return null;
}

async function pushImapAction(
  account: any,
  action: "mark_read" | "mark_unread" | "trash",
  email: { message_id: string | null },
): Promise<{ ok: boolean; error?: string }> {
  let imap: Imap | null = null;
  try {
    imap = await openInbox(account);
    const uid = await resolveImapUid(imap, account.id, email.message_id);
    if (!uid) return { ok: false, error: "imap message not found" };
    const cmd =
      action === "mark_read"
        ? `UID STORE ${uid} +FLAGS.SILENT (\\Seen)`
        : action === "mark_unread"
          ? `UID STORE ${uid} -FLAGS.SILENT (\\Seen)`
          : `UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`;
    const res = await imap.cmd(cmd);
    if (!res.ok) return { ok: false, error: res.statusLine };
    if (action === "trash") await imap.cmd("EXPUNGE").catch(() => null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    try {
      await imap?.cmd("LOGOUT");
    } catch {
      /* noop */
    }
    try {
      imap?.close();
    } catch {
      /* noop */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync logic
// ─────────────────────────────────────────────────────────────────────────────
async function syncOne(account: any, admin: any, testOnly?: { server: string; port: number; username: string; password: string }): Promise<{ ok: boolean; count: number; error?: string }> {
  const creds = testOnly ? testOnly : (account.credentials ?? {});
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) return { ok: false, count: 0, error: "missing credentials" };

  // Charge les paramètres de sécurité de l'utilisateur (HDS)
  const { data: secRow } = await admin
    .from("security_settings")
    .select("sensitivity_level,whitelist,blacklist")
    .eq("user_id", account.user_id)
    .maybeSingle();
  const secLevel = (secRow?.sensitivity_level ?? "normal") as "strict" | "normal" | "permissive";
  const whitelist: string[] = secRow?.whitelist ?? [];
  const blacklist: string[] = secRow?.blacklist ?? [];

  console.log(`[sync-imap] connecting account=${account.name} host=${host}:${port} sec=${secLevel}`);

  let imap: Imap | null = null;
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    imap = new Imap(conn);

    await imap.readGreeting();

    const loginRes = await imap.cmd(`LOGIN "${escapeArg(user)}" "${escapeArg(pass)}"`);
    if (!loginRes.ok) throw new Error(`LOGIN failed: ${loginRes.statusLine}`);

    const selRes = await imap.cmd("SELECT INBOX");
    if (!selRes.ok) throw new Error(`SELECT failed: ${selRes.statusLine}`);

    const since = account.last_sync_at
      ? new Date(account.last_sync_at)
      : new Date(Date.now() - 30 * 86400000);
    since.setDate(since.getDate() - 1);
    const sinceStr = formatImapDate(since);

    const searchRes = await imap.cmd(`UID SEARCH SINCE ${sinceStr}`);
    if (!searchRes.ok) throw new Error(`SEARCH failed: ${searchRes.statusLine}`);

    const uids = extractSearchUids(searchRes.rawText);
    console.log(`[sync-imap] ${uids.length} UIDs since ${sinceStr}`);

    if (uids.length === 0) {
      await imap.cmd("LOGOUT");
      imap.close();
      await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
      return { ok: true, count: 0 };
    }

    // CPU budget tight (~2s) → process at most 20 newest UIDs per invocation.
    // Next cron tick (or manual sync) picks up the rest from last_sync_at.
    const MAX_PER_RUN = 20;
    const toFetch = (!account.last_sync_at ? uids.slice(-500) : uids).slice(-MAX_PER_RUN);

    // Tombstones: message_ids the user already deleted — never resurrect them.
    const { data: tombstones } = await admin
      .from("deleted_emails")
      .select("message_id")
      .eq("account_id", account.id);
    const deletedSet = new Set<string>((tombstones ?? []).map((r: any) => r.message_id));

    let count = 0;

    // Cap each message at 25MB (standard provider attachment limit). Smaller batch (2)
    // keeps peak memory bounded (~50MB/batch).
    for (let i = 0; i < toFetch.length; i += 2) {
      const batch = toFetch.slice(i, i + 2);
      const fetchRes = await imap.cmd(
        `UID FETCH ${batch.join(",")} (UID FLAGS BODY.PEEK[]<0.26214400>)`
      );
      if (!fetchRes.ok) {
        console.error(`[sync-imap] FETCH batch failed: ${fetchRes.statusLine}`);
        continue;
      }
      const messages = parseFetchResponse(fetchRes.rawText, fetchRes.literals);
      for (const msg of messages) {
        try {
          const { headers } = splitRawMime(msg.raw);
          const parsed: ParsedPart = { textPlain: "", textHtml: "", attachments: 0, files: [] };
          walkMime(msg.raw, parsed);

          const from = parseAddress(headers["from"] || "");
          const to = parseAddress(headers["to"] || "");
          const subject = decodeMimeWord(headers["subject"] || "") || null;
          const messageId = headers["message-id"] || `${account.id}-${msg.uid}`;
          if (deletedSet.has(messageId)) { continue; }
          const receivedAt = headers["date"] ? new Date(headers["date"]).toISOString() : new Date().toISOString();


          const bodyText = parsed.textPlain ? parsed.textPlain.slice(0, 100000) : null;
          const { data: existingEmail } = await admin
            .from("emails")
            .select("is_read")
            .eq("account_id", account.id)
            .eq("message_id", messageId)
            .maybeSingle();
          const isRead = existingEmail?.is_read === true ? true : msg.flags.includes("\\Seen");
          const sens = detectSensitive({
            subject,
            from_address: from.address,
            body_text: bodyText,
          }, secLevel, whitelist, blacklist);

          const { data: upserted, error: upErr } = await admin.from("emails").upsert({
            account_id: account.id,
            user_id: account.user_id,
            message_id: messageId,
            from_address: from.address,
            from_name: from.name,
            to_address: to.address,
            subject,
            body_text: bodyText,
            body_html: parsed.textHtml ? parsed.textHtml.slice(0, 200000) : null,
            meeting_link: extractMeetingLink(bodyText, parsed.textHtml ?? null),
            has_attachment: parsed.attachments > 0,
            received_at: receivedAt,
            is_read: isRead,
            is_starred: msg.flags.includes("\\Flagged"),
            origin_tag: detectOrigin(to.address, (account.credentials as any)?.email ?? (account.credentials as any)?.username),
            thread_id: headers["in-reply-to"] || null,
            is_sensitive: sens.isSensitive,
            sensitive_reason: sens.isSensitive ? sens.reasons.join(" · ") : null,
            sensitive_score: sens.isSensitive ? sens.score : null,
          }, { onConflict: "account_id,message_id", ignoreDuplicates: false })
            .select("id")
            .maybeSingle();

          if (upErr) { console.error(`[sync-imap] upsert error`, upErr); continue; }
          count++;

          // Persist attachments → bucket "documents" + table documents
          if (upserted?.id && parsed.files.length > 0) {
            for (const file of parsed.files) {
              await persistAttachment(admin, account.user_id, account.id, upserted.id, sens.isSensitive, file);
            }
          }
        } catch (e) {
          console.error(`[sync-imap] msg parse failed`, e);
        }
      }
    }


    await imap.cmd("LOGOUT").catch(() => {});
    imap.close();
    await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
    return { ok: true, count };
  } catch (e: any) {
    try { imap?.close(); } catch { /* noop */ }
    return { ok: false, count: 0, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP entry point
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: {
      account_id?: string;
      force_full?: boolean;
      test_credentials?: { server: string; port: number; username: string; password: string };
      action?: "mark_read" | "mark_unread" | "trash";
      email_id?: string;
      message_id?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      /* empty body OK for cron */
    }

    // Test de connexion rapide (sans compte enregistré)
    if (body.test_credentials) {
      const tc = body.test_credentials;
      const r = await syncOne({ credentials: tc } as any, admin, tc);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ") && authHeader !== `Bearer ${ANON}`) {
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }

    // Bidirectional action push (read / unread / trash) for IMAP-backed sources,
    // including CHU redirects imported through the IMAP account.
    if (body.action) {
      let email: { message_id: string | null; account_id: string } | null = null;
      if (body.email_id) {
        let eq = admin.from("emails").select("message_id, account_id").eq("id", body.email_id);
        if (userId) eq = eq.eq("user_id", userId);
        const { data } = await eq.maybeSingle();
        email = data as any;
      } else if (body.message_id && body.account_id) {
        email = { message_id: body.message_id, account_id: body.account_id };
      }
      if (!email) {
        return new Response(JSON.stringify({ ok: false, error: "email not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let accQ = admin.from("accounts").select("*").eq("id", email.account_id).eq("type", "imap");
      if (userId) accQ = accQ.eq("user_id", userId);
      const { data: account } = await accQ.maybeSingle();
      if (!account) {
        return new Response(JSON.stringify({ ok: false, error: "account not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await pushImapAction(account, body.action, email);
      console.log(`[sync-imap] action=${body.action} email_id=${body.email_id} result=`, result);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let q = admin.from("accounts").select("*").eq("is_active", true).eq("type", "imap");
    if (userId) q = q.eq("user_id", userId);
    if (body.account_id) q = q.eq("id", body.account_id);

    const { data: accounts, error } = await q;
    if (error) throw error;

    // force_full: re-sync depuis 30j (utile pour récupérer bodies/PJ sur mails déjà importés)
    if (body.force_full && accounts) {
      for (const acc of accounts) acc.last_sync_at = null;
    }

    // Run sync in background to avoid CPU/wall-time limits on the request path.
    const runAll = async () => {
      const results: any[] = [];
      for (const acc of accounts ?? []) {
        const timeoutP = new Promise<{ ok: false; count: 0; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, count: 0, error: "account sync timeout (60s)" }), 60000)
        );
        const r = await Promise.race([syncOne(acc, admin), timeoutP]);
        console.log(`[sync-imap] account=${acc.name} result=`, r);
        results.push({ account_id: acc.id, name: acc.name, ...r });
      }
      return results;
    };

    // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runAll().catch((e) => console.error("[sync-imap] bg error", e)));
      return new Response(
        JSON.stringify({ ok: true, accounts: (accounts ?? []).length, queued: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = await runAll();
    const totalSynced = results.reduce((s, r) => s + (r.count ?? 0), 0);
    return new Response(
      JSON.stringify({ ok: true, accounts: results.length, synced: totalSynced, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[sync-imap] fatal", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
