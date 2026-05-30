// Global session-expiry detection.
// Listens for Supabase errors anywhere in the app and emits a `session-expired` event
// when the refresh token is invalid, so the UI can show a reconnect banner.

let expired = false;

export function isSessionExpired(): boolean {
  return expired;
}

export function markSessionExpired(reason?: string) {
  if (expired) return;
  expired = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("session-expired", { detail: { reason } }));
  }
}

export function clearSessionExpired() {
  expired = false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("session-restored"));
  }
}

/** Inspects an arbitrary error/response and flags session expiry if it matches the known patterns. */
export function checkSupabaseError(error: unknown): void {
  if (!error) return;
  const e = error as { message?: string; code?: string; status?: number; name?: string };
  const msg = (e.message ?? "").toLowerCase();
  const code = (e.code ?? "").toLowerCase();
  if (
    code === "refresh_token_not_found" ||
    code === "invalid_refresh_token" ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid refresh token") ||
    msg.includes("jwt expired") ||
    (e.status === 401 && msg.includes("token"))
  ) {
    markSessionExpired(e.message);
  }
}

// Patch global fetch ONCE to detect Supabase auth failures transparently.
let patched = false;
export function installFetchSessionGuard() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await orig(input as RequestInfo, init);
    try {
      const url = typeof input === "string" ? input : (input as Request).url ?? "";
      if (
        url.includes("supabase.co") &&
        (url.includes("/auth/v1/token") || url.includes("/rest/v1/") || url.includes("/storage/v1/")) &&
        (res.status === 401 || res.status === 403)
      ) {
        // Peek at the body without consuming it
        try {
          const cloned = res.clone();
          const txt = await cloned.text();
          if (
            txt.includes("refresh_token_not_found") ||
            txt.includes("invalid_refresh_token") ||
            txt.includes("JWT expired") ||
            txt.includes("invalid JWT")
          ) {
            markSessionExpired(txt.slice(0, 200));
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return res;
  };
}
