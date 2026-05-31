import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listPending, flushQueue } from "@/lib/sync-queue";

export type SyncState = "online" | "syncing" | "offline";

export function useSyncStatus() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(async () => {
    const ops = await listPending();
    setPending(ops.length);
  }, []);

  useEffect(() => {
    refreshPending();
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

  const syncNow = useCallback(async (): Promise<{ flushed: number; imap: number }> => {
    setSyncing(true);
    try {
      const flushRes = await flushQueue();
      await refreshPending();

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
          const invoke = supabase.functions.invoke(fn, { body: {} });
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

      return { flushed: flushRes.ok, imap: imapCount };
    } finally {
      setSyncing(false);
    }
  }, [refreshPending]);


  const state: SyncState = !online ? "offline" : syncing ? "syncing" : "online";
  return { state, online, syncing, pending, syncNow, refreshPending };
}
