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
      let imapCount = 0;
      try {
        const { data, error } = await supabase.functions.invoke("sync-imap", { body: {} });
        if (!error && data?.synced) imapCount = data.synced;
      } catch (e) {
        console.warn("[sync] sync-imap failed", e);
      }
      return { flushed: flushRes.ok, imap: imapCount };
    } finally {
      setSyncing(false);
    }
  }, [refreshPending]);

  const state: SyncState = !online ? "offline" : syncing ? "syncing" : "online";
  return { state, online, syncing, pending, syncNow, refreshPending };
}
