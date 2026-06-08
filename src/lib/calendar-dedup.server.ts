import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CalendarDedupRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  is_all_day: boolean;
  recurrence_rule: string | null;
  source: string | null;
  account_id: string | null;
  google_event_id: string | null;
  gcal_connection_id: string | null;
  outlook_event_id: string | null;
  outlook_connection_id: string | null;
  created_at: string;
  updated_at: string;
};

function dedupKey(ev: CalendarDedupRow): string {
  const text = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const date = (value: string) => new Date(value).toISOString();
  return [text(ev.title), date(ev.start_at), date(ev.end_at), text(ev.location), ev.is_all_day ? "all-day" : "timed"].join("|");
}

function dedupScore(ev: CalendarDedupRow): number {
  let score = 0;
  if (ev.google_event_id || ev.outlook_event_id) score += 100;
  if (ev.gcal_connection_id || ev.outlook_connection_id) score += 30;
  if (ev.recurrence_rule?.trim()) score += 20;
  if (ev.account_id) score += 10;
  score += Math.min(9, Math.floor(new Date(ev.updated_at ?? ev.created_at).getTime() / 1_000_000_000_000));
  return score;
}

export async function deduplicateCalendarEventsForUser(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select(
      "id,title,start_at,end_at,location,is_all_day,recurrence_rule,source,account_id,google_event_id,gcal_connection_id,outlook_event_id,outlook_connection_id,created_at,updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`Failed to load events for deduplication: ${error.message}`);

  const groups = new Map<string, CalendarDedupRow[]>();
  for (const ev of (data ?? []) as CalendarDedupRow[]) {
    const key = dedupKey(ev);
    const list = groups.get(key) ?? [];
    list.push(ev);
    groups.set(key, list);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const [keep, ...duplicates] = [...group].sort((a, b) => {
      const scoreDelta = dedupScore(b) - dedupScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    const duplicateIds = duplicates.map((ev) => ev.id);
    if (duplicateIds.length === 0) continue;

    await Promise.all([
      supabaseAdmin.from("meetings").update({ calendar_event_id: keep.id }).in("calendar_event_id", duplicateIds),
      supabaseAdmin.from("tasks").update({ calendar_event_id: keep.id }).in("calendar_event_id", duplicateIds),
    ]);

    const googleTombstones = duplicates
      .filter((ev) => ev.gcal_connection_id && ev.google_event_id)
      .map((ev) => ({
        user_id: userId,
        gcal_connection_id: ev.gcal_connection_id!,
        google_event_id: ev.google_event_id!,
      }));
    if (googleTombstones.length > 0) {
      await supabaseAdmin
        .from("deleted_calendar_events")
        .upsert(googleTombstones, { onConflict: "gcal_connection_id,google_event_id" });
    }

    const { error: deleteErr } = await supabaseAdmin.from("calendar_events").delete().in("id", duplicateIds);
    if (deleteErr) throw new Error(`Failed to delete duplicate calendar events: ${deleteErr.message}`);
    removed += duplicateIds.length;
  }

  if (removed > 0) console.log(`Calendar deduplication removed ${removed} duplicate event(s)`);
  return removed;
}