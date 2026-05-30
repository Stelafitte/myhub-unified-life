// Generic IndexedDB cache for offline-first reads.
// Each entity gets its own object store (keyPath: "id"), capped to MAX per store (LRU by updated_at/received_at).
//
// Usage:
//   await cachePut("contacts", items);
//   const cached = await cacheGetAll<Contact>("contacts");
//   await cacheDelete("contacts", id);

const DB_NAME = "myhubpro-local-cache";
const DB_VERSION = 2;
const MAX_PER_STORE = 1000;

export type CacheStore =
  | "contacts"
  | "calendar_events"
  | "meetings"
  | "tasks"
  | "op_plan_themes"
  | "op_plan_subthemes"
  | "accounts"
  | "emails";

const STORES: CacheStore[] = [
  "contacts",
  "calendar_events",
  "meetings",
  "tasks",
  "op_plan_themes",
  "op_plan_subthemes",
  "accounts",
  "emails",
];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getSortField(item: Record<string, unknown>): string {
  const v =
    (item.updated_at as string | undefined) ??
    (item.received_at as string | undefined) ??
    (item.start_at as string | undefined) ??
    (item.created_at as string | undefined) ??
    "";
  return v ?? "";
}

export async function cachePut<T extends { id: string }>(store: CacheStore, items: T[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const it of items) os.put(it);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await trimStore(db, store);
    db.close();
  } catch {
    /* ignore cache errors silently */
  }
}

export async function cacheReplaceAll<T extends { id: string }>(store: CacheStore, items: T[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    os.clear();
    for (const it of items) os.put(it);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function cacheGetAll<T>(store: CacheStore): Promise<T[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, "readonly");
    const all = await new Promise<T[]>((res, rej) => {
      const r = tx.objectStore(store).getAll();
      r.onsuccess = () => res(r.result as T[]);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all.sort((a, b) =>
      getSortField(b as Record<string, unknown>).localeCompare(getSortField(a as Record<string, unknown>)),
    );
  } catch {
    return [];
  }
}

export async function cacheDelete(store: CacheStore, id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await new Promise<void>((r) => { tx.oncomplete = () => r(); });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function cacheClear(store: CacheStore): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    await new Promise<void>((r) => { tx.oncomplete = () => r(); });
    db.close();
  } catch {
    /* ignore */
  }
}

async function trimStore(db: IDBDatabase, store: CacheStore): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  const all = await new Promise<Array<Record<string, unknown> & { id: string }>>((res, rej) => {
    const r = os.getAll();
    r.onsuccess = () => res(r.result as Array<Record<string, unknown> & { id: string }>);
    r.onerror = () => rej(r.error);
  });
  if (all.length <= MAX_PER_STORE) return;
  all.sort((a, b) => getSortField(b).localeCompare(getSortField(a)));
  const toDelete = all.slice(MAX_PER_STORE);
  for (const e of toDelete) os.delete(e.id);
  await new Promise<void>((r) => { tx.oncomplete = () => r(); });
}

export async function wipeAllCaches(): Promise<void> {
  for (const s of STORES) await cacheClear(s);
}
