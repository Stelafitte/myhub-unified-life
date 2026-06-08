// MyHub Pro v1.0
import { Moon, Sun, Wifi, WifiOff, LogOut, RefreshCw, Loader2, Plus, CheckSquare, Search, X, Sparkles } from "lucide-react";
import { MicButton } from "@/components/ui/mic-button";
import { AiAssistantModal } from "@/components/ai/ai-assistant-modal";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/lib/theme-provider";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useAuth } from "@/lib/auth-context";
import { useTaskPanel } from "@/lib/task-panel-context";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";

export function AppHeader() {
  const { theme, toggle } = useTheme();
  const { state, pending, syncing, syncNow } = useSyncStatus();
  const { user, signOut } = useAuth();
  const { openCreate } = useTaskPanel();
  const navigate = useNavigate();
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  const handleSync = async (e?: React.MouseEvent) => {
    const forceFull = !!(e && (e.shiftKey || e.altKey));
    if (forceFull) toast.info("Resynchronisation complète (30 derniers jours)…");
    const res = await syncNow(forceFull ? { forceFull: true } : undefined);
    toast.success(`Sync : ${res.flushed} action(s) envoyée(s), ${res.imap} email(s) reçu(s)`);
  };

  // Auto-sync trigger: fired by sync-queue.requestAutoSync() after a task /
  // meeting / calendar event is created. Silent (no toast) to avoid noise.
  const autoBusy = useRef(false);
  useEffect(() => {
    const onAuto = async () => {
      if (autoBusy.current || syncing || !navigator.onLine) return;
      autoBusy.current = true;
      try { await syncNow(); } catch { /* ignore */ }
      finally { autoBusy.current = false; }
    };
    window.addEventListener("auto-sync-request", onAuto);
    return () => window.removeEventListener("auto-sync-request", onAuto);
  }, [syncNow, syncing]);


  const badgeClass =
    state === "offline"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : state === "syncing"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

  const label =
    state === "offline"
      ? pending > 0 ? `Hors ligne — ${pending} en attente` : "Hors ligne"
      : state === "syncing"
      ? "Synchronisation…"
      : pending > 0 ? `En ligne — ${pending} à envoyer` : "En ligne — synchronisé";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1.5 border-b bg-background/80 px-2 sm:gap-3 sm:px-4 backdrop-blur">
      <SidebarTrigger className="h-9 w-9 shrink-0 border border-border/60 bg-muted/40 text-foreground hover:bg-muted [&_svg]:!size-5" />

      <GlobalSearchBar />

      <div className="flex-1" />

      <button
        onClick={handleSync}
        disabled={syncing || state === "offline"}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-60 ${badgeClass}`}
        title="Synchroniser maintenant (Maj+clic = resynchronisation complète 30j)"
      >
        {state === "syncing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : state === "offline" ? <WifiOff className="h-3.5 w-3.5" />
          : <Wifi className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{label}</span>
      </button>
      <Button variant="ghost" size="icon" onClick={handleSync} disabled={syncing || state === "offline"} aria-label="Synchroniser" title="Synchroniser (Maj+clic = full 30j)" className="hidden sm:inline-flex">
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
      </Button>

      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>

      <Button variant="ghost" size="sm" onClick={() => openCreate()} className="h-8 gap-1 text-xs font-medium" aria-label="Nouvelle tâche">
        <CheckSquare className="h-4 w-4" />
        <span className="hidden sm:inline">Nouvelle tâche</span>
        <span className="sm:hidden">Tâche</span>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
    </header>
  );
}

function GlobalSearchBar() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q.length < 2) {
      toast.error("Saisissez au moins 2 caractères");
      return;
    }
    navigate({ to: "/search", search: { q } });
  };

  const clear = () => {
    setValue("");
    inputRef.current?.focus();
  };

  const openAi = () => {
    setAiSeed(value.trim().length >= 2 ? value.trim() : undefined);
    setAiOpen(true);
  };

  return (
    <>
      <form onSubmit={onSubmit} className="mx-1 flex min-w-0 w-full max-w-[560px] flex-1 items-center gap-1.5 sm:mx-3 max-sm:focus-within:absolute max-sm:focus-within:left-12 max-sm:focus-within:right-2 max-sm:focus-within:top-2 max-sm:focus-within:z-50 max-sm:focus-within:mx-0 max-sm:focus-within:max-w-none max-sm:focus-within:bg-background">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Rechercher dans MyHub Pro…"
            aria-label="Recherche globale"
            className="h-9 w-full min-w-0 rounded-md border border-border/60 bg-muted/40 pl-8 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40 sm:pr-28"
          />
          <MicButton
            targetRef={inputRef}
            className="absolute right-8 top-1/2 -translate-y-1/2 sm:right-20"
            iconSize={14}
          />
          {value && (
            <button
              type="button"
              onClick={clear}
              aria-label="Effacer"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:right-12"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            Entrée
          </kbd>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openAi}
          aria-label="Assistant IA"
          title="Assistant IA"
          className="h-9 gap-1.5 shrink-0 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-semibold">IA</span>
        </Button>
      </form>
      <AiAssistantModal open={aiOpen} onOpenChange={setAiOpen} initialPrompt={aiSeed} />
    </>
  );
}
