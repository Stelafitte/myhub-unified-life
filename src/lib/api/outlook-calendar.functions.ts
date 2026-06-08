import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://connector-gateway.lovable.dev/microsoft_outlook";

type OEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
};

export const syncOutlookCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}).optional())
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { deduplicateCalendarEventsForUser } = await import("@/lib/calendar-dedup.server");
    let totalDeduped = 0;

    try {
      totalDeduped += await deduplicateCalendarEventsForUser(userId);
    } catch (e) {
      console.warn("Outlook calendar pre-sync deduplication skipped", e);
    }

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const OUTLOOK_KEY = process.env.MICROSOFT_OUTLOOK_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!OUTLOOK_KEY) throw new Error("MICROSOFT_OUTLOOK_API_KEY not configured (Outlook connector not linked)");

    // Find the Outlook account for this user
    const { data: account, error: accErr } = await supabaseAdmin
      .from("accounts")
      .select("id, user_id, last_sync_at")
      .eq("user_id", userId)
      .eq("type", "outlook")
      .eq("is_active", true)
      .maybeSingle();
    if (accErr) throw new Error(accErr.message);
    if (!account) {
      return { synced: 0, deduped: totalDeduped, message: "Aucun compte Outlook actif" };
    }

    const headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": OUTLOOK_KEY,
    };

    const startWindow = new Date(Date.now() - 30 * 86400_000).toISOString();
    const endWindow = new Date(Date.now() + 180 * 86400_000).toISOString();

    // calendarView expands recurring events automatically
    const select = encodeURIComponent(
      "id,subject,bodyPreview,body,location,start,end,isAllDay,isCancelled",
    );
    let url =
      `${GATEWAY}/me/calendarView` +
      `?startDateTime=${encodeURIComponent(startWindow)}` +
      `&endDateTime=${encodeURIComponent(endWindow)}` +
      `&$select=${select}&$top=200&$orderby=start/dateTime`;

    let totalSynced = 0;
    let safety = 20;
    while (url && safety-- > 0) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Outlook calendarView ${res.status}: ${t.slice(0, 200)}`);
      }
      const body = (await res.json()) as { value?: OEvent[]; "@odata.nextLink"?: string };
      const items = body.value ?? [];

      const rows = items
        .filter((e) => !e.isCancelled && e.start?.dateTime && e.end?.dateTime)
        .map((e) => {
          // Outlook returns local datetime + timezone. If timeZone is UTC the
          // value is already ISO; otherwise we treat it as UTC-naive — Graph
          // normally returns UTC unless Prefer header overrides it.
          const startStr = e.start!.dateTime!.endsWith("Z")
            ? e.start!.dateTime!
            : `${e.start!.dateTime!}Z`;
          const endStr = e.end!.dateTime!.endsWith("Z")
            ? e.end!.dateTime!
            : `${e.end!.dateTime!}Z`;
          const html = (e.body?.contentType ?? "").toLowerCase() === "html" ? e.body?.content ?? "" : "";
          const description = html
            ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000)
            : e.bodyPreview ?? null;
          return {
            user_id: userId,
            account_id: account.id,
            external_id: e.id,
            title: e.subject ?? "(sans titre)",
            description,
            location: e.location?.displayName ?? null,
            start_at: startStr,
            end_at: endStr,
            is_all_day: !!e.isAllDay,
            source: "outlook" as const,
            sync_direction: "pull" as const,
          };
        });

      if (rows.length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from("calendar_events")
          .upsert(rows, { onConflict: "account_id,external_id" });
        if (upErr) throw new Error(`Upsert failed: ${upErr.message}`);
        totalSynced += rows.length;
      }

      url = body["@odata.nextLink"] ?? "";
    }

    await supabaseAdmin
      .from("accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", account.id);

    try {
      totalDeduped += await deduplicateCalendarEventsForUser(userId);
    } catch (e) {
      console.warn("Outlook calendar post-sync deduplication skipped", e);
    }

    return { synced: totalSynced, deduped: totalDeduped };
  });
