/**
 * Stockage local chiffré pour les documents sensibles.
 * Réutilise la clé du SecureVault. Les blobs ne quittent jamais l'appareil.
 */

const DB_NAME = "myhubpro-doc-vault";
const DB_VERSION = 1;
const STORE = "docs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

type EncryptedBlob = {
  id: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  mime: string;
  added_at: number;
};

export async function encryptAndStore(key: CryptoKey, id: string, file: Blob): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
  const item: EncryptedBlob = { id, iv: iv.buffer, ciphertext, mime: file.type || "application/octet-stream", added_at: Date.now() };
  await tx("readwrite", (s) => s.put(item));
}

export async function decryptBlob(key: CryptoKey, id: string): Promise<Blob | null> {
  const item = await tx<EncryptedBlob | undefined>("readonly", (s) => s.get(id) as IDBRequest<EncryptedBlob | undefined>);
  if (!item) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: item.iv }, key, item.ciphertext);
  return new Blob([plain], { type: item.mime });
}

export async function deleteSecureBlob(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
