// Service worker registration with strict guards against Lovable preview iframe.
// Only runs on top-level windows of the published (or installed) app.

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  // Detect iframe (Lovable preview)
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") && host.includes("-dev.");

  // Always clean up any previous registration in dev/preview
  if (inIframe || isPreviewHost || import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[SW] register failed", err);
    });
  });
}
