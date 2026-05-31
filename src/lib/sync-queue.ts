// Offline sync queue: enqueues pending mutations when offline,
// flushes them when network returns.

import { supabase } from "@/integrations/supabase/client";

export type QueuedAction = "create" | "update" | "delete";
export type QueuedEntity =
  | "task"
  | "email"
  | "calendar_event"
  | "contact"
  | "meeting"
  | "op_plan_theme"
  | "op_plan_subtheme";

export type QueuedOp = {
  id: string;
  entity_type: QueuedEntity;
  entity_id?: string;
  action: QueuedAction;
  payload?: Record<string, unknown>;
  created_at: string;
};

const DB_NAME = "myhubpro-sync";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(op: Omit<QueuedOp, "id" | "created_at">): Promise<string> {
  const id = crypto.randomUUID();
  const record: QueuedOp = { ...op, id, created_at: new Date().toISOString() };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record);
  await new Promise<void>((r) => { tx.oncomplete = () => r(); });
  db.close();
  window.dispatchEvent(new CustomEvent("sync-queue-changed"));
  return id;
}

export async function listPending(): Promise<QueuedOp[]> {
  if (!("indexedDB" in window)) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all: QueuedOp[] = await new Promise((res, rej) => {
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result as QueuedOp[]);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all;
  } catch {
    return [];
  }
}

async function removeOp(id: string) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await new Promise<void>((r) => { tx.oncomplete = () => r(); });
  db.close();
}

export async function flushQueue(onProgress?: () => void): Promise<{ ok: number; failed: number }> {
  if (!navigator.onLine) return { ok: 0, failed: 0 };
  const ops = await listPending();
  let ok = 0, failed = 0;
  for (const op of ops) {
    try {
      if (op.entity_type === "task") {
        if (op.action === "create" && op.payload) {
          await supabase.from("tasks").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("tasks").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("tasks").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "email") {
        // Email mutations: read/starred/archived flags
        if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("emails").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("emails").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "calendar_event") {
        if (op.action === "create" && op.payload) {
          await supabase.from("calendar_events").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("calendar_events").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("calendar_events").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "contact") {
        if (op.action === "create" && op.payload) {
          await supabase.from("contacts").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("contacts").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("contacts").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "meeting") {
        if (op.action === "create" && op.payload) {
          await supabase.from("meetings").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("meetings").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("meetings").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "op_plan_theme") {
        if (op.action === "create" && op.payload) {
          await supabase.from("op_plan_themes").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("op_plan_themes").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("op_plan_themes").delete().eq("id", op.entity_id);
        }
      } else if (op.entity_type === "op_plan_subtheme") {
        if (op.action === "create" && op.payload) {
          await supabase.from("op_plan_subthemes").insert(op.payload as never);
        } else if (op.action === "update" && op.entity_id && op.payload) {
          await supabase.from("op_plan_subthemes").update(op.payload as never).eq("id", op.entity_id);
        } else if (op.action === "delete" && op.entity_id) {
          await supabase.from("op_plan_subthemes").delete().eq("id", op.entity_id);
        }
      }
      await removeOp(op.id);
      ok++;
    } catch (err) {
      console.warn("[sync-queue] flush failed for op", op.id, err);
      failed++;
    }
    onProgress?.();
  }
  // Notify listeners of queue size change
  window.dispatchEvent(new CustomEvent("sync-queue-changed"));
  return { ok, failed };
}

export function installOnlineFlusher(cb?: () => void) {
  const handler = async () => {
    const res = await flushQueue();
    cb?.();
    if (res.ok > 0) {
      const { toast } = await import("sonner");
      toast.success(`${res.ok} action${res.ok > 1 ? "s" : ""} synchronisée${res.ok > 1 ? "s" : ""}`);
    }
  };
  window.addEventListener("online", handler);
  if (navigator.onLine) handler();
  return () => window.removeEventListener("online", handler);
}

/** Notify other tabs / hooks that the queue changed (after enqueue). */
export function notifyQueueChanged() {
  window.dispatchEvent(new CustomEvent("sync-queue-changed"));
}

/**
 * Request an automatic sync run. The header listens for this and triggers
 * syncNow() (debounced) so newly created tasks / events / meetings propagate
 * immediately without the user having to click "Synchroniser".
 */
let _autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
export function requestAutoSync(delayMs = 600) {
  if (typeof window === "undefined") return;
  if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(() => {
    _autoSyncTimer = null;
    window.dispatchEvent(new CustomEvent("auto-sync-request"));
  }, delayMs);
}
