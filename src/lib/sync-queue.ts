// Offline sync queue: enqueues pending mutations when offline,
// flushes them when network returns.

import { supabase } from "@/integrations/supabase/client";

export type QueuedAction = "create" | "update" | "delete";
export type QueuedEntity = "task" | "email" | "calendar_event" | "contact";

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
      }
      await removeOp(op.id);
      ok++;
    } catch {
      failed++;
    }
    onProgress?.();
  }
  return { ok, failed };
}

export function installOnlineFlusher(cb?: () => void) {
  const handler = () => { flushQueue().then(() => cb?.()); };
  window.addEventListener("online", handler);
  if (navigator.onLine) handler();
  return () => window.removeEventListener("online", handler);
}
