import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Cron-triggered RSVP reminder dispatcher.
 *
 * Picks meetings whose start_at is approaching the per-meeting
 * `rsvp_reminder_hours_before` window, and that haven't had a reminder
 * sent yet (`rsvp_reminder_sent_at IS NULL`). Logs pending participants
 * to the audit_log table and marks the meeting as reminded.
 *
 * Email delivery is intentionally a TODO: it will plug into the
 * transactional email infra (template `meeting-rsvp-reminder`) once
 * scaffolded. This route is idempotent thanks to `rsvp_reminder_sent_at`.
 */
export const Route = createFileRoute("/api/public/hooks/rsvp-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (apikey !== process.env.SUPABASE_ANON_KEY && apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = Date.now();
        // Look ahead 72h max (covers all configurable windows up to 72h).
        const horizonIso = new Date(now + 72 * 3600_000).toISOString();
        const nowIso = new Date(now).toISOString();

        const { data: meetings, error } = await supabaseAdmin
          .from("meetings")
          .select("id, user_id, title, start_at, rsvp_reminder_hours_before, status")
          .is("rsvp_reminder_sent_at", null)
          .neq("status", "cancelled")
          .gte("start_at", nowIso)
          .lte("start_at", horizonIso);

        if (error) {
          console.error("rsvp-reminders: query failed", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        let processed = 0;
        let pendingTotal = 0;

        for (const m of meetings ?? []) {
          const hoursBefore = (m.rsvp_reminder_hours_before as number) ?? 24;
          const triggerMs = new Date(m.start_at).getTime() - hoursBefore * 3600_000;
          // Trigger window: from triggerMs to triggerMs + 1h (matches 30-min cron cadence with margin).
          if (now < triggerMs || now > triggerMs + 3600_000) continue;

          // Check user setting opt-out.
          const { data: settings } = await supabaseAdmin
            .from("meeting_settings")
            .select("rsvp_reminders_enabled")
            .eq("user_id", m.user_id)
            .maybeSingle();
          if (settings && settings.rsvp_reminders_enabled === false) {
            await supabaseAdmin
              .from("meetings")
              .update({ rsvp_reminder_sent_at: new Date().toISOString() })
              .eq("id", m.id);
            continue;
          }

          const { data: pending } = await supabaseAdmin
            .from("meeting_participants")
            .select("email, name")
            .eq("meeting_id", m.id)
            .eq("rsvp_status", "pending");

          const recipients = (pending ?? []) as { email: string; name: string | null }[];
          pendingTotal += recipients.length;

          await supabaseAdmin.from("audit_log").insert({
            user_id: m.user_id,
            actor_id: null,
            action: "meeting.rsvp_reminder_dispatched",
            metadata: {
              meeting_id: m.id,
              title: m.title,
              pending_count: recipients.length,
              recipients: recipients.map((r) => r.email),
            },
          });

          // TODO: when transactional email infra is enabled, send
          // template "meeting-rsvp-reminder" to each `recipients[i].email`.

          await supabaseAdmin
            .from("meetings")
            .update({ rsvp_reminder_sent_at: new Date().toISOString() })
            .eq("id", m.id);

          processed++;
        }

        return Response.json({ ok: true, processed, pendingTotal });
      },
    },
  },
});
