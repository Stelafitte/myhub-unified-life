// Edge Function: purge-imap-source
// Deletes from the IMAP server (OVH/Roundcube/generic IMAP) the messages whose
// message_id is listed in `deleted_emails` for a given account. Uses UID STORE +
// EXPUNGE. After a successful purge, removes the corresponding tombstones.
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

// ─── Minimal IMAP client (copy of sync-imap) ──────────────────────────────────
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
    try { this.reader.releaseLock(); } catch { /* */ }
    try { this.writer.releaseLock(); } catch { /* */ }
    try { this.conn.close(); } catch { /* */ }
  }
  private async readMore() {
    const { value, done } = await this.reader.read();
    if (done || !value) throw new Error("IMAP closed");
    const merged = new Uint8Array(this.buffer.length + value.length);
    merged.set(this.buffer); merged.set(value, this.buffer.length);
    this.buffer = merged;
  }
  private findCRLF() {
    for (let i = 0; i < this.buffer.length - 1; i++)
      if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) return i;
    return -1;
  }
  private async readLine() {
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
  private async readBytes(n: number) {
    while (this.buffer.length < n) await this.readMore();
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }
  async readGreeting() { return await this.readLine(); }
  async cmd(command: string) {
    this.tagCounter++;
    const tag = "A" + this.tagCounter.toString().padStart(4, "0");
    await this.writer.write(this.encoder.encode(`${tag} ${command}\r\n`));
    let rawText = ""; const literals: Uint8Array[] = [];
    while (true) {
      const line = await this.readLine();
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        rawText += line + "\r\n";
        literals.push(await this.readBytes(parseInt(lit[1])));
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

function escapeArg(s: string) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

async function purgeAccount(
  account: any,
  admin: any,
): Promise<{ ok: boolean; purged: number; tombstones: number; error?: string }> {
  const creds = account.credentials ?? {};
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) return { ok: false, purged: 0, tombstones: 0, error: "missing credentials" };

  // Load tombstones (message_ids to purge)
  const { data: ts } = await admin
    .from("deleted_emails")
    .select("message_id")
    .eq("account_id", account.id);
  const wanted = new Set<string>((ts ?? []).map((r: any) => r.message_id).filter(Boolean));
  if (wanted.size === 0) return { ok: true, purged: 0, tombstones: 0 };

  let imap: Imap | null = null;
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    imap = new Imap(conn);
    await imap.readGreeting();

    const login = await imap.cmd(`LOGIN "${escapeArg(user)}" "${escapeArg(pass)}"`);
    if (!login.ok) throw new Error(`LOGIN failed: ${login.statusLine}`);

    const sel = await imap.cmd("SELECT INBOX");
    if (!sel.ok) throw new Error(`SELECT failed: ${sel.statusLine}`);

    let purged = 0;
    const purgedIds: string[] = [];

    // For each tombstone, search by Message-ID header on the server then mark+expunge.
    for (const mid of wanted) {
      // Strip surrounding < >
      const clean = mid.replace(/^<|>$/g, "");
      const search = await imap.cmd(`UID SEARCH HEADER "Message-ID" "${escapeArg(clean)}"`);
      if (!search.ok) continue;
      const m = search.rawText.match(/\* SEARCH([0-9 \r\n]*)/);
      const uids = m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
      if (uids.length === 0) {
        // Already gone from the server — drop the tombstone too
        purgedIds.push(mid);
        continue;
      }
      const store = await imap.cmd(`UID STORE ${uids.join(",")} +FLAGS (\\Deleted)`);
      if (store.ok) {
        purged += uids.length;
        purgedIds.push(mid);
      }
    }

    if (purged > 0) {
      await imap.cmd("EXPUNGE");
    }
    await imap.cmd("LOGOUT");
    imap.close();
    imap = null;

    if (purgedIds.length > 0) {
      await admin.from("deleted_emails").delete()
        .eq("account_id", account.id)
        .in("message_id", purgedIds);
    }

    return { ok: true, purged, tombstones: purgedIds.length };
  } catch (e: any) {
    try { imap?.close(); } catch { /* */ }
    return { ok: false, purged: 0, tombstones: 0, error: e?.message ?? String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Must be admin
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { account_id?: string } = {};
    try { body = await req.json(); } catch { /* */ }

    let q = admin.from("accounts").select("*").eq("is_active", true).in("type", ["imap"]);
    if (body.account_id) q = q.eq("id", body.account_id);
    const { data: accounts, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      const r = await purgeAccount(acc, admin);
      console.log(`[purge-imap-source] account=${acc.name}`, r);
      results.push({ account_id: acc.id, name: acc.name, ...r });
    }

    return new Response(JSON.stringify({
      ok: true,
      accounts: results.length,
      purged: results.reduce((s, r) => s + (r.purged ?? 0), 0),
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[purge-imap-source] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
