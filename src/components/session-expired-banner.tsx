// MyHub Pro v1.0
import { useEffect, useState } from "react";
import { AlertTriangle, LogIn, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { isSessionExpired, clearSessionExpired } from "@/lib/session-guard";

export function SessionExpiredBanner() {
  const [visible, setVisible] = useState(isSessionExpired());
  const [dismissed, setDismissed] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onExpired = () => { setVisible(true); setDismissed(false); };
    const onRestored = () => setVisible(false);
    window.addEventListener("session-expired", onExpired);
    window.addEventListener("session-restored", onRestored);
    return () => {
      window.removeEventListener("session-expired", onExpired);
      window.removeEventListener("session-restored", onRestored);
    };
  }, []);

  if (!visible || dismissed) return null;

  const handleReconnect = async () => {
    clearSessionExpired();
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="sticky top-14 z-20 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <strong>Session expirée.</strong> Vos données locales restent disponibles, mais la
          synchronisation et le chargement de nouvelles données nécessitent une reconnexion.
          Les actions effectuées hors ligne ne seront envoyées qu'après reconnexion.
        </div>
        <Button size="sm" onClick={handleReconnect} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
          <LogIn className="h-3.5 w-3.5" />
          Se reconnecter
        </Button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Masquer"
          className="rounded p-1 hover:bg-amber-500/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
