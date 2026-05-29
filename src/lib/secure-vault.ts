/**
 * Coffre sécurisé local — chiffrement AES-256-GCM + PBKDF2 (Web Crypto).
 * Stockage IndexedDB. La clé n'existe qu'en mémoire (après déverrouillage par PIN).
 * Aucune donnée ne sort de l'appareil.
 */

const DB_NAME = "myhubpro-vault";
const DB_VERSION = 1;
const STORE_ITEMS = "items";
const STORE_META = "meta";

const PBKDF2_ITER = 250_000;
const KEY_LEN = 256;

export type VaultItem = {
  id: string; // email uuid
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
  added_at: number;
  preview: { from?: string | null; subject?: string | null; received_at?: string | null };
};

export type VaultEmail = {
  id: string;
  from_address: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  sensitive_reason: string | null;
  sensitive_score: number | null;
};

type VaultMeta = {
  id: "config";
  salt: ArrayBuffer;
  verifier_iv: ArrayBuffer;
  verifier_ct: ArrayBuffer; // chiffrement d'un payload connu pour valider le PIN
  created_at: number;
};

const VERIFIER_PLAINTEXT = "myhubpro-vault-v1";

// ---------- IndexedDB ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

async function getAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

// ---------- Crypto ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(pin: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LEN },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptJson(key: CryptoKey, obj: unknown): Promise<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: iv.buffer, ciphertext };
}

async function decryptJson<T>(key: CryptoKey, iv: ArrayBuffer, ciphertext: ArrayBuffer): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(dec.decode(plain)) as T;
}

// ---------- Public API ----------

export async function isVaultInitialized(): Promise<boolean> {
  const meta = await tx<VaultMeta | undefined>(STORE_META, "readonly", (s) => s.get("config") as IDBRequest<VaultMeta | undefined>);
  return !!meta;
}

/** Initialise le coffre avec un PIN. Échoue si déjà initialisé. */
export async function initVault(pin: string): Promise<CryptoKey> {
  if (await isVaultInitialized()) throw new Error("Coffre déjà initialisé");
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const key = await deriveKey(pin, salt);
  const { iv, ciphertext } = await encryptJson(key, VERIFIER_PLAINTEXT);
  const meta: VaultMeta = { id: "config", salt, verifier_iv: iv, verifier_ct: ciphertext, created_at: Date.now() };
  await tx(STORE_META, "readwrite", (s) => s.put(meta));
  return key;
}

/** Déverrouille le coffre. Renvoie la clé en mémoire ou lance une erreur si PIN invalide. */
export async function unlockVault(pin: string): Promise<CryptoKey> {
  const meta = await tx<VaultMeta | undefined>(STORE_META, "readonly", (s) => s.get("config") as IDBRequest<VaultMeta | undefined>);
  if (!meta) throw new Error("Coffre non initialisé");
  const key = await deriveKey(pin, meta.salt);
  try {
    const plain = await decryptJson<string>(key, meta.verifier_iv, meta.verifier_ct);
    if (plain !== VERIFIER_PLAINTEXT) throw new Error("PIN invalide");
    return key;
  } catch {
    throw new Error("PIN invalide");
  }
}

export async function putEmail(key: CryptoKey, email: VaultEmail): Promise<void> {
  const { iv, ciphertext } = await encryptJson(key, email);
  const item: VaultItem = {
    id: email.id,
    ciphertext,
    iv,
    added_at: Date.now(),
    preview: { from: email.from_address, subject: email.subject, received_at: email.received_at },
  };
  await tx(STORE_ITEMS, "readwrite", (s) => s.put(item));
}

export async function listVaultItems(): Promise<VaultItem[]> {
  const items = await getAll<VaultItem>(STORE_ITEMS);
  return items.sort((a, b) => b.added_at - a.added_at);
}

export async function getEmail(key: CryptoKey, id: string): Promise<VaultEmail | null> {
  const item = await tx<VaultItem | undefined>(STORE_ITEMS, "readonly", (s) => s.get(id) as IDBRequest<VaultItem | undefined>);
  if (!item) return null;
  return decryptJson<VaultEmail>(key, item.iv, item.ciphertext);
}

export async function deleteEmail(id: string): Promise<void> {
  await tx(STORE_ITEMS, "readwrite", (s) => s.delete(id));
}

export async function vaultCount(): Promise<number> {
  return tx<number>(STORE_ITEMS, "readonly", (s) => s.count());
}

/** Détruit tout le coffre (oubli de PIN). */
export async function destroyVault(): Promise<void> {
  await tx(STORE_ITEMS, "readwrite", (s) => s.clear());
  await tx(STORE_META, "readwrite", (s) => s.clear());
}
