import { useEffect, useState, useCallback } from "react";

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

export function useNavOrder(defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(() => {
    const stored = loadNavOrder();
    if (!stored) return defaultOrder;
    // merge: keep stored items that still exist, append new defaults
    const filtered = stored.filter((u) => defaultOrder.includes(u));
    const missing = defaultOrder.filter((u) => !filtered.includes(u));
    return [...filtered, ...missing];
  });

  useEffect(() => {
    const handler = () => {
      const stored = loadNavOrder();
      if (!stored) {
        setOrder(defaultOrder);
        return;
      }
      const filtered = stored.filter((u) => defaultOrder.includes(u));
      const missing = defaultOrder.filter((u) => !filtered.includes(u));
      setOrder([...filtered, ...missing]);
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
  }, []);

  const reset = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("myhub:nav-order-changed"));
    }
    setOrder(defaultOrder);
  }, [defaultOrder]);

  return { order, setOrder: update, reset };
}
