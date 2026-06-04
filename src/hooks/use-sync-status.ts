import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listPending, flushQueue } from "@/lib/sync-queue";
import { syncOutlookCalendarEvents } from "@/lib/api/outlook-calendar.functions";
import { syncGoogleCalendarEvents } from "@/lib/api/google-calendar.functions";

export type SyncState = "online" | "syncing" | "offline";

export function useSyncStatus() {
  // Always start `true` on first render to match SSR; the effect below syncs
  // with `navigator.onLine` after hydration to avoid mismatch errors.
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(async () => {
    const ops = await listPending();
    setPending(ops.length);
  }, []);

  useEffect(() => {
    refreshPending();
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const ch = () => refreshPending();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("sync-queue-changed", ch);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("sync-queue-changed", ch);
    };
  }, [refreshPending]);

  const syncNowRef = useRef<((opts?: { forceFull?: boolean }) => Promise<{ flushed: number; imap: number }>) | null>(null);

  // Auto-sync every 2 minutes when online
  useEffect(() => {
    if (!online) return;
    const interval = setInterval(() => {
      if (!syncing && navigator.onLine) {
        syncNowRef.current?.().catch((e: unknown) => console.warn("[auto-sync] failed", e));
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [online, syncing]);

  const syncNow = useCallback(async (opts?: { forceFull?: boolean }): Promise<{ flushed: number; imap: number }> => {
    setSyncing(true);
    try {
      const flushRes = await flushQueue();
      await refreshPending();
      const body = opts?.forceFull ? { force_full: true } : {};

      // Determine which providers the user actually has active accounts for
      let providers: Array<"imap" | "gmail" | "outlook"> = ["imap"];
      try {
        const { data: accs } = await supabase
          .from("accounts")
          .select("type")
          .eq("is_active", true);
        const types = new Set((accs ?? []).map((a) => a.type as string));
        providers = ["imap", "gmail", "outlook"].filter((t) =>
          t === "imap" ? types.has("imap") || types.size === 0 : types.has(t),
        ) as Array<"imap" | "gmail" | "outlook">;
        if (providers.length === 0) providers = ["imap"];
      } catch (e) {
        console.warn("[sync] account lookup failed", e);
      }

      const callOne = async (fn: "sync-imap" | "sync-gmail" | "sync-outlook") => {
        try {
          const invoke = supabase.functions.invoke(fn, { body });
          const timeout = new Promise((resolve) =>
            setTimeout(() => resolve({ data: null, error: new Error("timeout") }), 20000),
          );
          const { data, error } = (await Promise.race([invoke, timeout])) as any;
          if (error) {
            console.warn(`[sync] ${fn} error`, error);
            return 0;
          }
          return typeof data?.synced === "number" ? data.synced : 0;
        } catch (e) {
          console.warn(`[sync] ${fn} failed`, e);
          return 0;
        }
      };

      const results = await Promise.all(
        providers.map((p) =>
          callOne(
            p === "imap" ? "sync-imap" : p === "gmail" ? "sync-gmail" : "sync-outlook",
          ),
        ),
      );
      const imapCount = results.reduce((a, b) => a + b, 0);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("emails-synced", { detail: { synced: imapCount } }));
      }

      // Calendar sync (Outlook / Google) — only if user enabled it in settings
      // and frequency != -1 (manual). Failures are silent (background sync).
      try {
        const { data: syncSettings } = await supabase
          .from("sync_settings")
          .select("source, direction, sync_frequency_minutes")
          .in("source", ["outlook_calendar", "google_calendar"]);
        const enabled = (src: string) => {
          const s = (syncSettings ?? []).find((x) => x.source === src);
          return s && s.direction !== "disabled" && s.sync_frequency_minutes !== -1;
        };
        const calJobs: Promise<unknown>[] = [];
        if (enabled("outlook_calendar")) {
          calJobs.push(
            syncOutlookCalendarEvents({ data: {} }).then(async (r) => {
              await supabase.from("sync_settings").update({ last_sync_at: new Date().toISOString() }).eq("source", "outlook_calendar");
              return r;
            }).catch((e) => console.warn("[sync] outlook_calendar failed", e)),
          );
        }
        if (enabled("google_calendar")) {
          calJobs.push(
            syncGoogleCalendarEvents({ data: {} }).then(async (r) => {
              await supabase.from("sync_settings").update({ last_sync_at: new Date().toISOString() }).eq("source", "google_calendar");
              return r;
            }).catch((e) => console.warn("[sync] google_calendar failed", e)),
          );
        }
        if (calJobs.length > 0) await Promise.all(calJobs);
      } catch (e) {
        console.warn("[sync] calendar sync skipped", e);
      }

      return { flushed: flushRes.ok, imap: imapCount };
    } finally {
      setSyncing(false);
    }
  }, [refreshPending]);

  // Keep ref in sync so the interval always calls the latest function
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);


  const state: SyncState = !online ? "offline" : syncing ? "syncing" : "online";
  return { state, online, syncing, pending, syncNow, refreshPending };
}
