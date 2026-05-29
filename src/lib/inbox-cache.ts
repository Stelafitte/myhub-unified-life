// Lightweight IndexedDB cache for offline-readable emails.
// Keeps the last N emails per account.

const DB_NAME = "myhubpro-inbox";
const STORE = "emails";
const DB_VERSION = 1;
export const MAX_PER_ACCOUNT = 200;

export type CachedEmail = {
  id: string;
  account_id: string;
  user_id: string;
  message_id: string | null;
  from_address: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  labels: string[] | null;
  has_attachment: boolean;
  thread_id: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("account_id", "account_id");
        store.createIndex("received_at", "received_at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheEmails(emails: CachedEmail[]): Promise<void> {
  if (!("indexedDB" in window) || emails.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const e of emails) store.put(e);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    // Trim per account to MAX_PER_ACCOUNT (newest first).
    const accountIds = Array.from(new Set(emails.map((e) => e.account_id)));
    for (const accId of accountIds) await trimAccount(db, accId);
    db.close();
  } catch {
    /* ignore cache errors */
  }
}

async function trimAccount(db: IDBDatabase, accountId: string): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const idx = store.index("account_id");
  const all: CachedEmail[] = await new Promise((res, rej) => {
    const req = idx.getAll(accountId);
    req.onsuccess = () => res(req.result as CachedEmail[]);
    req.onerror = () => rej(req.error);
  });
  all.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
  const toDelete = all.slice(MAX_PER_ACCOUNT);
  for (const e of toDelete) store.delete(e.id);
  await new Promise<void>((res) => {
    tx.oncomplete = () => res();
  });
}

export async function loadCachedEmails(): Promise<CachedEmail[]> {
  if (!("indexedDB" in window)) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const all: CachedEmail[] = await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result as CachedEmail[]);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return all.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
  } catch {
    return [];
  }
}
