import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "myhub.nav-order.v1";

export function loadNavOrder(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveNavOrder(order: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  window.dispatchEvent(new CustomEvent("myhub:nav-order-changed"));
}

async function persistNavOrderRemote(order: string[] | null) {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase.from("profiles").update({ nav_order: order }).eq("id", uid);
  } catch {
    // best-effort
  }
}

function mergeWithDefaults(stored: string[], defaultOrder: string[]) {
  const filtered = stored.filter((u) => defaultOrder.includes(u));
  const missing = defaultOrder.filter((u) => !filtered.includes(u));
  return [...filtered, ...missing];
}

export function useNavOrder(defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(() => {
    const stored = loadNavOrder();
    if (!stored) return defaultOrder;
    return mergeWithDefaults(stored, defaultOrder);
  });
  const hydratedRef = useRef(false);

  // Hydrate from DB on mount / auth change
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return;
        const { data, error } = await supabase
          .from("profiles")
          .select("nav_order")
          .eq("id", uid)
          .maybeSingle();
        if (cancelled || error || !data) return;
        const remote = (data as { nav_order: string[] | null }).nav_order;
        if (remote && Array.isArray(remote) && remote.length > 0) {
          const merged = mergeWithDefaults(remote, defaultOrder);
          setOrder(merged);
          saveNavOrder(merged);
        } else {
          // No remote value: push local order up if any
          const local = loadNavOrder();
          if (local && local.length > 0) {
            await persistNavOrderRemote(mergeWithDefaults(local, defaultOrder));
          }
        }
      } finally {
        hydratedRef.current = true;
      }
    };
    hydrate();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") hydrate();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [defaultOrder]);

  useEffect(() => {
    const handler = () => {
      const stored = loadNavOrder();
      if (!stored) {
        setOrder(defaultOrder);
        return;
      }
      setOrder(mergeWithDefaults(stored, defaultOrder));
    };
    window.addEventListener("myhub:nav-order-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("myhub:nav-order-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [defaultOrder]);

  const update = useCallback((next: string[]) => {
    setOrder(next);
    saveNavOrder(next);
    void persistNavOrderRemote(next);
  }, []);

  const reset = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("myhub:nav-order-changed"));
    }
    setOrder(defaultOrder);
    void persistNavOrderRemote(null);
  }, [defaultOrder]);

  return { order, setOrder: update, reset };
}
