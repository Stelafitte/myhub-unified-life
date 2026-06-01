// Edge Function: purge-gmail-source
// For each tombstone in `deleted_emails` (account.type = 'gmail'), find the
// matching Gmail message via `rfc822msgid:` search and move it to trash
// (gmail.modify scope). Tombstones are removed once trashed.
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
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GMAIL_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gh() {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GMAIL_KEY,
  };
}

async function purgeAccount(account: any, admin: any) {
  const { data: ts } = await admin
    .from("deleted_emails")
    .select("message_id")
    .eq("account_id", account.id);
  const wanted = (ts ?? []).map((r: any) => r.message_id).filter(Boolean) as string[];
  if (wanted.length === 0) return { ok: true, purged: 0 };

  let purged = 0;
  const purgedTombstones: string[] = [];

  for (const mid of wanted) {
    const clean = mid.replace(/^<|>$/g, "");
    try {
      const q = encodeURIComponent(`rfc822msgid:${clean}`);
      const sr = await fetch(`${GATEWAY}/users/me/messages?q=${q}&maxResults=5`, { headers: gh() });
      if (!sr.ok) continue;
      const sj = await sr.json();
      const ids: string[] = (sj.messages ?? []).map((m: any) => m.id).filter(Boolean);
      if (ids.length === 0) {
        // Already gone from Gmail — drop the tombstone too
        purgedTombstones.push(mid);
        continue;
      }
      let anyOk = false;
      for (const id of ids) {
        const tr = await fetch(`${GATEWAY}/users/me/messages/${id}/trash`, { method: "POST", headers: gh() });
        if (tr.ok) anyOk = true;
        else console.warn(`[purge-gmail-source] trash ${id} ${tr.status}`);
      }
      if (anyOk) {
        purged += ids.length;
        purgedTombstones.push(mid);
      }
    } catch (e) {
      console.warn(`[purge-gmail-source] error for ${mid}`, e);
    }
  }

  if (purgedTombstones.length > 0) {
    await admin.from("deleted_emails").delete()
      .eq("account_id", account.id)
      .in("message_id", purgedTombstones);
  }
  return { ok: true, purged };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
    if (!GMAIL_KEY) throw new Error("GOOGLE_MAIL_API_KEY missing — connector not linked");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: { account_id?: string } = {};
    try { body = await req.json(); } catch { /* */ }

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

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      const r = await purgeAccount(acc, admin);
      console.log(`[purge-gmail-source] account=${acc.name}`, r);
      results.push({ account_id: acc.id, name: acc.name, ...r });
    }
    return new Response(JSON.stringify({
      ok: true,
      accounts: results.length,
      purged: results.reduce((s, r) => s + (r.purged ?? 0), 0),
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[purge-gmail-source] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
