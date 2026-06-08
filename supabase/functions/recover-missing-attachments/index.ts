// Edge Function: recover-missing-attachments
// Scans recent emails where has_attachment=true but no documents exist,
// and invokes fetch-email-attachments for each. Throttled and capped.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
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

    const body = await req.json().catch(() => ({})) as { days?: number; limit?: number };
    const days = Math.min(Math.max(body.days ?? 30, 1), 180);
    const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);

    const since = new Date(Date.now() - days * 86400_000).toISOString();
    // Pull candidates: emails with has_attachment, in window, for this user.
    const { data: candidates, error } = await admin
      .from("emails")
      .select("id")
      .eq("user_id", userId)
      .eq("has_attachment", true)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const ids = (candidates ?? []).map((c: any) => c.id);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ ok: true, scanned: 0, recovered: 0, processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find which ones already have docs
    const { data: existing } = await admin
      .from("documents")
      .select("source_id")
      .eq("source_type", "email")
      .in("source_id", ids);
    const have = new Set((existing ?? []).map((d: any) => d.source_id));
    const missing = ids.filter((id) => !have.has(id)).slice(0, limit);

    let recovered = 0;
    let processed = 0;
    for (const emailId of missing) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/fetch-email-attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ email_id: emailId }),
        });
        processed++;
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j?.ok && typeof j.count === "number") recovered += j.count;
        }
      } catch (e) {
        console.error("[recover-missing-attachments]", emailId, e);
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: ids.length, missing: missing.length, processed, recovered }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[recover-missing-attachments] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
