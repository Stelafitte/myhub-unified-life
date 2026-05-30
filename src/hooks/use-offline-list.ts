// Generic offline-first list hook: shows cached data instantly, then refetches in background.
import { useCallback, useEffect, useState } from "react";
import { cacheGetAll, cacheReplaceAll, type CacheStore } from "@/lib/local-cache";
import { checkSupabaseError } from "@/lib/session-guard";

type Result<T> = {
  data: T[];
  loading: boolean;
  fromCache: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/**
 * @param store IndexedDB store key
 * @param fetcher async function returning the fresh server data (or null on auth failure)
 * @param deps  deps that trigger a reload when changed
 */
export function useOfflineList<T extends { id: string }>(
  store: CacheStore,
  fetcher: () => Promise<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  deps: React.DependencyList = [],
): Result<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // 1. Cache first
    const cached = await cacheGetAll<T>(store);
    if (cached.length > 0) {
      setData(cached);
      setFromCache(true);
    }
    // 2. Network (best-effort)
    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const { data: fresh, error: err } = await fetcher();
        if (err) {
          checkSupabaseError(err);
          setError(err.message);
        } else if (fresh) {
          setData(fresh);
          setFromCache(false);
          await cacheReplaceAll(store, fresh);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        checkSupabaseError(e);
        setError(msg);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    const onOnline = () => load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  return { data, loading, fromCache, error, reload: load };
}
