// Edge Function: sync-imap
// Client IMAP minimal natif Deno (TLS brut). Compatible Supabase Edge Runtime.
// - Appelée par pg_cron (toutes les 15 min) ou manuellement par l'app.
// - JWT utilisateur → ne synchronise que ses comptes IMAP actifs.
// - Sinon (anon/cron) → tous les comptes IMAP actifs.

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

type EmailOrigin = "chu" | "univ" | "gmail" | "outlook" | "imap";

function detectOrigin(toAddress: string | null): EmailOrigin {
  const to = (toAddress ?? "").toLowerCase();
  if (to.includes("@myhub-pro.fr") && to.startsWith("chu@")) return "chu";
  if (to.includes("univ") || to.includes("@etu.") || to.includes("@u-")) return "univ";
  if (to.includes("@gmail.")) return "gmail";
  if (to.includes("@outlook.") || to.includes("@hotmail.") || to.includes("@live.")) return "outlook";
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
        // After the literal, additional text continues on the same logical line — keep reading.
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
// Parsers
// ─────────────────────────────────────────────────────────────────────────────
type FetchMsg = { uid: number; flags: string[]; headers: Uint8Array; text: Uint8Array };

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

    let headers = new Uint8Array(0);
    let text = new Uint8Array(0);
    const atomRe = /(BODY\[[^\]]*\](?:<\d+\.\d+>)?) \{(\d+)\}/g;
    let am;
    while ((am = atomRe.exec(chunk)) !== null) {
      const atom = am[1];
      const lit = literals[litIdx++];
      if (!lit) continue;
      if (atom.startsWith("BODY[HEADER")) headers = lit;
      else if (atom.startsWith("BODY[TEXT")) text = lit;
    }
    out.push({ uid, flags, headers, text });
  }
  return out;
}

function decodeMimeWord(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === "B") {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else {
        return data
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_x: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch {
      return data;
    }
  });
}

function parseHeaders(raw: Uint8Array): Record<string, string> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
  const unfolded = text.replace(/\r\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of unfolded.split(/\r\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.substring(0, i).trim().toLowerCase();
    const v = line.substring(i + 1).trim();
    if (!out[k]) out[k] = decodeMimeWord(v);
  }
  return out;
}

function parseAddress(s: string): { address: string | null; name: string | null } {
  if (!s) return { address: null, name: null };
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { address: m[2].trim(), name: (m[1] || "").trim() || null };
  return { address: s.trim(), name: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync logic
// ─────────────────────────────────────────────────────────────────────────────
async function syncOne(account: any, admin: any): Promise<{ ok: boolean; count: number; error?: string }> {
  const creds = account.credentials ?? {};
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) return { ok: false, count: 0, error: "missing credentials" };

  console.log(`[sync-imap] connecting account=${account.name} host=${host}:${port} user=${user}`);

  let imap: Imap | null = null;
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    imap = new Imap(conn);

    const greeting = await imap.readGreeting();
    console.log(`[sync-imap] greeting: ${greeting.substring(0, 100)}`);

    const loginRes = await imap.cmd(`LOGIN "${escapeArg(user)}" "${escapeArg(pass)}"`);
    if (!loginRes.ok) throw new Error(`LOGIN failed: ${loginRes.statusLine}`);
    console.log(`[sync-imap] logged in`);

    const selRes = await imap.cmd("SELECT INBOX");
    if (!selRes.ok) throw new Error(`SELECT failed: ${selRes.statusLine}`);

    const since = account.last_sync_at
      ? new Date(account.last_sync_at)
      : new Date(Date.now() - 30 * 86400000);
    since.setDate(since.getDate() - 1);
    const sinceStr = formatImapDate(since);

    const searchRes = await imap.cmd(`UID SEARCH SINCE ${sinceStr}`);
    if (!searchRes.ok) throw new Error(`SEARCH failed: ${searchRes.statusLine}`);

    const uids: number[] = [];
    const sm = searchRes.rawText.match(/\* SEARCH([0-9 \r\n]*)/);
    if (sm) {
      uids.push(...sm[1].trim().split(/\s+/).filter(Boolean).map(Number).filter((n) => !isNaN(n)));
    }
    console.log(`[sync-imap] found ${uids.length} UIDs since ${sinceStr}`);

    if (uids.length === 0) {
      await imap.cmd("LOGOUT");
      imap.close();
      await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
      return { ok: true, count: 0 };
    }

    const toFetch = !account.last_sync_at ? uids.slice(-200) : uids;

    let count = 0;
    for (let i = 0; i < toFetch.length; i += 30) {
      const batch = toFetch.slice(i, i + 30);
      const fetchRes = await imap.cmd(
        `UID FETCH ${batch.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID DATE IN-REPLY-TO)] BODY.PEEK[TEXT]<0.50000>)`
      );
      if (!fetchRes.ok) {
        console.error(`[sync-imap] FETCH batch failed: ${fetchRes.statusLine}`);
        continue;
      }
      const messages = parseFetchResponse(fetchRes.rawText, fetchRes.literals);
      for (const msg of messages) {
        try {
          const h = parseHeaders(msg.headers);
          const from = parseAddress(h["from"] || "");
          const to = parseAddress(h["to"] || "");
          const bodyText = msg.text.length
            ? new TextDecoder("utf-8", { fatal: false }).decode(msg.text).slice(0, 50000)
            : null;

          const messageId = h["message-id"] || `${account.id}-${msg.uid}`;
          const receivedAt = h["date"] ? new Date(h["date"]).toISOString() : new Date().toISOString();

          const { error: upErr } = await admin.from("emails").upsert({
            account_id: account.id,
            user_id: account.user_id,
            message_id: messageId,
            from_address: from.address,
            from_name: from.name,
            to_address: to.address,
            subject: h["subject"] || null,
            body_text: bodyText,
            received_at: receivedAt,
            is_read: msg.flags.includes("\\Seen"),
            is_starred: msg.flags.includes("\\Flagged"),
            origin_tag: detectOrigin(to.address),
            thread_id: h["in-reply-to"] || null,
          }, { onConflict: "account_id,message_id", ignoreDuplicates: false });

          if (upErr) console.error(`[sync-imap] upsert error`, upErr);
          else count++;
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
    let body: { account_id?: string } = {};
    try { body = await req.json(); } catch { /* empty body OK for cron */ }

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ") && authHeader !== `Bearer ${ANON}`) {
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }

    let q = admin.from("accounts").select("*").eq("is_active", true).eq("type", "imap");
    if (userId) q = q.eq("user_id", userId);
    if (body.account_id) q = q.eq("id", body.account_id);

    const { data: accounts, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      // Hard cap par compte: 45s
      const timeoutP = new Promise<{ ok: false; count: 0; error: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, count: 0, error: "account sync timeout (45s)" }), 45000)
      );
      const r = await Promise.race([syncOne(acc, admin), timeoutP]);
      console.log(`[sync-imap] account=${acc.name} result=`, r);
      results.push({ account_id: acc.id, name: acc.name, ...r });
    }

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
