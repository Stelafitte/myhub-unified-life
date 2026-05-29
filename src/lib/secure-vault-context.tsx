import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  initVault,
  unlockVault,
  isVaultInitialized,
  vaultCount,
} from "@/lib/secure-vault";

type VaultState = {
  initialized: boolean;
  unlocked: boolean;
  key: CryptoKey | null;
  count: number;
  unlock: (pin: string) => Promise<void>;
  create: (pin: string) => Promise<void>;
  lock: () => void;
  refreshCount: () => Promise<void>;
};

const Ctx = createContext<VaultState | null>(null);

const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 min

export function SecureVaultProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [count, setCount] = useState(0);
  const lockTimer = useRef<number | null>(null);

  useEffect(() => {
    isVaultInitialized().then(setInitialized);
    vaultCount().then(setCount).catch(() => setCount(0));
  }, []);

  function armAutoLock() {
    if (lockTimer.current) window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => setKey(null), AUTO_LOCK_MS);
  }

  async function unlock(pin: string) {
    const k = await unlockVault(pin);
    setKey(k);
    setInitialized(true);
    armAutoLock();
    setCount(await vaultCount());
  }

  async function create(pin: string) {
    const k = await initVault(pin);
    setKey(k);
    setInitialized(true);
    armAutoLock();
  }

  function lock() {
    setKey(null);
    if (lockTimer.current) window.clearTimeout(lockTimer.current);
  }

  async function refreshCount() {
    setCount(await vaultCount());
  }

  return (
    <Ctx.Provider value={{ initialized, unlocked: !!key, key, count, unlock, create, lock, refreshCount }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSecureVault() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSecureVault must be used inside SecureVaultProvider");
  return v;
}
