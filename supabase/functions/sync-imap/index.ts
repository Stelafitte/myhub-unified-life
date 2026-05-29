// Edge Function: sync-imap
// Synchronise les emails IMAP (OVH et autres) vers la table `emails`.
// - Appelée par le cron pg_cron (toutes les 15 min) ou manuellement par l'app.
// - Si Authorization JWT utilisateur fourni → ne synchronise que ses comptes.
// - Sinon (anon/cron) → synchronise tous les comptes IMAP actifs.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.156";

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

async function syncOne(account: any, admin: any): Promise<{ ok: boolean; count: number; error?: string }> {
  const creds = account.credentials ?? {};
  const host = creds.server || creds.host;
  const port = Number(creds.port ?? 993);
  const user = creds.username || creds.user;
  const pass = creds.password;
  if (!host || !user || !pass) return { ok: false, count: 0, error: "missing credentials" };

  const client = new ImapFlow({
    host, port, secure: port === 993,
    auth: { user, pass },
    logger: false,
    socketTimeout: 30000,
  });

  let count = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Determine fetch range: since last sync (with 1 day buffer) or last 200 emails
      const since = account.last_sync_at ? new Date(account.last_sync_at) : null;
      if (since) since.setDate(since.getDate() - 1);

      const searchCriteria = since ? { since } : { all: true };
      const uids = await client.search(searchCriteria, { uid: true });
      if (!uids || uids.length === 0) return { ok: true, count: 0 };

      // First sync: cap at 200 most recent
      const toFetch = since ? uids : uids.slice(-200);

      // Fetch envelope + bodyparts
      for await (const msg of client.fetch(toFetch, {
        uid: true,
        envelope: true,
        flags: true,
        source: false,
        bodyParts: ["TEXT"],
      }, { uid: true })) {
        try {
          const env = msg.envelope;
          const messageId = env?.messageId ?? `${account.id}-${msg.uid}`;
          const from = env?.from?.[0];
          const to = env?.to?.[0];
          const subject = env?.subject ?? null;
          const receivedAt = env?.date ? new Date(env.date).toISOString() : new Date().toISOString();
          const fromAddress = from ? `${from.mailbox}@${from.host}` : null;
          const fromName = from?.name ?? null;
          const toAddress = to ? `${to.mailbox}@${to.host}` : null;
          const flags = msg.flags ?? new Set<string>();
          const isRead = flags.has("\\Seen");
          const isStarred = flags.has("\\Flagged");

          const bodyTextRaw = msg.bodyParts?.get("TEXT");
          const bodyText = bodyTextRaw ? new TextDecoder("utf-8").decode(bodyTextRaw).slice(0, 50000) : null;

          // Upsert by (account_id, message_id)
          const { error: upErr } = await admin.from("emails").upsert({
            account_id: account.id,
            user_id: account.user_id,
            message_id: messageId,
            from_address: fromAddress,
            from_name: fromName,
            to_address: toAddress,
            subject,
            body_text: bodyText,
            received_at: receivedAt,
            is_read: isRead,
            is_starred: isStarred,
            origin_tag: detectOrigin(toAddress),
            thread_id: env?.inReplyTo ?? null,
          }, { onConflict: "account_id,message_id", ignoreDuplicates: false });

          if (!upErr) count++;
        } catch (innerErr) {
          console.error("[sync-imap] msg parse failed", innerErr);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
    return { ok: true, count };
  } catch (e: any) {
    try { await client.close(); } catch { /* noop */ }
    return { ok: false, count, error: e?.message ?? String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: { account_id?: string } = {};
    try { body = await req.json(); } catch { /* empty body OK for cron */ }

    // Identify caller
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ") && authHeader !== `Bearer ${ANON}`) {
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }

    // Build accounts query
    let q = admin.from("accounts").select("*").eq("is_active", true).eq("type", "imap");
    if (userId) q = q.eq("user_id", userId);
    if (body.account_id) q = q.eq("id", body.account_id);

    const { data: accounts, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      const r = await syncOne(acc, admin);
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
