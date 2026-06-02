// MyHub Pro v1.0
import { Moon, Sun, Wifi, WifiOff, LogOut, RefreshCw, Loader2, CheckSquare, Search, X } from "lucide-react";
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
      <div className="flex-1" />
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focus shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const q = value.trim();
    if (q.length < 2) {
      toast.info("Saisissez au moins 2 caractères pour lancer la recherche.");
      return;
    }
    navigate({ to: "/search", search: { q } });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="hidden md:flex w-full max-w-[500px] items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm focus-within:border-border focus-within:bg-background transition-colors"
      role="search"
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="🔍 Rechercher dans MyHub Pro..."
        aria-label="Rechercher dans MyHub Pro"
        className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70"
      />
      {value && (
        <button
          type="button"
          onClick={() => { setValue(""); inputRef.current?.focus(); }}
          aria-label="Effacer la recherche"
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        Entrée
      </kbd>
    </form>
  );
}
