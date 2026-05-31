// Edge Function: sync-outlook
// Uses the Lovable connector gateway (Microsoft Graph) to fetch Outlook messages
// and store them in `emails`. Only fetches messages received after account creation
// or the last successful sync.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMeetingLink } from "../_shared/meeting-link.ts";
import { persistAttachment, base64ToBytes } from "../_shared/persist-attachment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const OUTLOOK_KEY = Deno.env.get("MICROSOFT_OUTLOOK_API_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/microsoft_outlook";

function gh() {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": OUTLOOK_KEY,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
}

async function syncOutlook(account: any, admin: any): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // Premier sync : 30 jours d'historique, ensuite incrémental.
    const sinceIso = account.last_sync_at
      ? account.last_sync_at
      : new Date(Date.now() - 30 * 86400000).toISOString();
    const filter = encodeURIComponent(`receivedDateTime ge ${new Date(sinceIso).toISOString()}`);
    const select = encodeURIComponent("id,internetMessageId,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead,hasAttachments,conversationId,flag");
    const top = account.last_sync_at ? 100 : 200;
    const url = `${GATEWAY}/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime%20desc&$filter=${filter}&$select=${select}`;

    const listRes = await fetch(url, { headers: gh() });
    if (!listRes.ok) {
      const t = await listRes.text();
      return { ok: false, count: 0, error: `list ${listRes.status}: ${t.slice(0, 200)}` };
    }
    const list = await listRes.json();
    const msgs: any[] = list.value ?? [];
    let count = 0;

    for (const m of msgs) {
      try {
        const fromAddr = m.from?.emailAddress?.address ?? null;
        const fromName = m.from?.emailAddress?.name ?? null;
        const toAddr = m.toRecipients?.[0]?.emailAddress?.address ?? null;
        const messageId = m.internetMessageId || m.id;
        const receivedAt = m.receivedDateTime ? new Date(m.receivedDateTime).toISOString() : new Date().toISOString();
        const isHtml = (m.body?.contentType || "").toLowerCase() === "html";
        const html = isHtml ? (m.body?.content ?? "") : "";
        const text = isHtml ? stripHtml(html) : (m.body?.content ?? m.bodyPreview ?? "");
        const isStarred = m.flag?.flagStatus === "flagged";

        const { error: upErr } = await admin.from("emails").upsert({
          account_id: account.id,
          user_id: account.user_id,
          message_id: messageId,
          from_address: fromAddr,
          from_name: fromName,
          to_address: toAddr,
          subject: m.subject || null,
          body_text: text || null,
          body_html: html || null,
          meeting_link: extractMeetingLink(text, html),
          has_attachment: !!m.hasAttachments,
          received_at: receivedAt,
          is_read: !!m.isRead,
          is_starred: isStarred,
          origin_tag: "outlook",
          thread_id: m.conversationId || null,
        }, { onConflict: "account_id,message_id", ignoreDuplicates: false });
        if (!upErr) count++;
        else console.error("[sync-outlook] upsert", upErr.message);
      } catch (e) {
        console.error("[sync-outlook] msg fail", e);
      }
    }

    await admin.from("accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", account.id);
    return { ok: true, count };
  } catch (e: any) {
    return { ok: false, count: 0, error: e?.message ?? String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
    if (!OUTLOOK_KEY) throw new Error("MICROSOFT_OUTLOOK_API_KEY missing — connector not linked");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: { account_id?: string; test?: boolean } = {};
    try { body = await req.json(); } catch { /* empty */ }

    // Quick connection test — use a Mail endpoint (the /me profile endpoint requires User.Read which isn't granted)
    if (body.test) {
      const r = await fetch(`${GATEWAY}/me/messages?$top=1&$select=id,from,toRecipients`, { headers: gh() });
      const data = await r.json().catch(() => ({}));
      // Extract email from @odata.context: users('foo%40bar.com')/messages...
      let emailAddress: string | null = null;
      const ctx: string = data?.["@odata.context"] ?? "";
      const m = ctx.match(/users\(['"]([^'"]+)['"]\)/);
      if (m) emailAddress = decodeURIComponent(m[1]);
      if (!emailAddress) emailAddress = data?.value?.[0]?.toRecipients?.[0]?.emailAddress?.address ?? null;
      return new Response(JSON.stringify({ ok: r.ok, status: r.status, profile: { emailAddress } }), {
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

    let q = admin.from("accounts").select("*").eq("is_active", true).eq("type", "outlook");
    if (userId) q = q.eq("user_id", userId);
    if (body.account_id) q = q.eq("id", body.account_id);

    const { data: accounts, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      const r = await syncOutlook(acc, admin);
      console.log(`[sync-outlook] account=${acc.name} result=`, r);
      results.push({ account_id: acc.id, name: acc.name, ...r });
    }

    return new Response(
      JSON.stringify({ ok: true, accounts: results.length, synced: results.reduce((s, r) => s + (r.count ?? 0), 0), results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[sync-outlook] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
