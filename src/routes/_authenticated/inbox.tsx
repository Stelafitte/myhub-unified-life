import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Inbox as InboxIcon,
  Search,
  Star,
  Paperclip,
  Archive,
  Trash2,
  Reply,
  ReplyAll,
  Forward,
  Mail,
  MailOpen,
  Plus,
  Zap,
  Tag,
  Circle,
  Clock,
  ChevronDown,
  Sparkles,
  Check,
  Lock,
  ShieldAlert,
  Settings2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { classifyPendingEmails } from "@/lib/api/email-classify.functions";
import { AiSuggestionsPanel } from "@/components/inbox/ai-suggestions-panel";
import { AiClassificationFeedback } from "@/components/inbox/ai-classification-feedback";
import { EmailAttachmentsPanel } from "@/components/inbox/email-attachments-panel";

import { CreateTaskFromEmailDialog } from "@/components/tasks/create-task-from-email-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";
import { cacheEmails, loadCachedEmails, type CachedEmail } from "@/lib/inbox-cache";
import { QuickAddOvh } from "@/components/inbox/quick-add-ovh";
import { useSecureVault } from "@/lib/secure-vault-context";
import { VaultPinDialog } from "@/components/security/vault-pin-dialog";
import { listThemes, classifyPendingThemes, discoverThemes, seedThemesFromFolders, setEmailTheme, type Theme } from "@/lib/api/themes.functions";
import { listOneDriveFolders } from "@/lib/api/onedrive.functions";
import { ThemesManagerDialog, EmailThemePicker } from "@/components/inbox/themes-manager-dialog";

type Account = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
};

type Email = CachedEmail;

type Filter = "all" | "unread" | "attachments" | "starred" | `account:${string}` | `theme:${string}` | "theme:__none__";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [usingCache, setUsingCache] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const classifyFn = useServerFn(classifyPendingEmails);
  const odFoldersFn = useServerFn(listOneDriveFolders);
  const [odGroups, setOdGroups] = useState<SmartGroup[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("inbox:odFolders");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { name: string; path: string; depth?: number }[];
      return smartGroupsFromFolders(parsed);
    } catch { return []; }
  });

  const toggleCheck = (id: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearChecked = () => setChecked(new Set());

  // Resizable column widths (persisted)
  const [leftW, setLeftW] = useState<number>(() => {
    const v = Number(localStorage.getItem("inbox:leftW")); return v >= 200 && v <= 500 ? v : 280;
  });
  const [rightW, setRightW] = useState<number>(() => {
    const v = Number(localStorage.getItem("inbox:rightW")); return v >= 320 && v <= 720 ? v : 420;
  });
  const startDrag = (which: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "left" ? leftW : rightW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (which === "left") {
        const w = Math.min(500, Math.max(200, startW + dx));
        setLeftW(w);
      } else {
        const w = Math.min(720, Math.max(320, startW - dx));
        setRightW(w);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      localStorage.setItem("inbox:leftW", String(which === "left" ? (document.documentElement.dataset._lw ?? leftW) : leftW));
      localStorage.setItem("inbox:rightW", String(which === "right" ? (document.documentElement.dataset._rw ?? rightW) : rightW));
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => { localStorage.setItem("inbox:leftW", String(leftW)); }, [leftW]);
  useEffect(() => { localStorage.setItem("inbox:rightW", String(rightW)); }, [rightW]);


  // Online/offline awareness
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Load cached data immediately on mount (independent of auth) for instant render
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedEmails();
      if (!cancelled && cached.length > 0) {
        setEmails((prev) => (prev.length === 0 ? cached : prev));
        setUsingCache(true);
      }
    })();
    try {
      const cachedAccs = localStorage.getItem("inbox:accounts");
      if (cachedAccs) {
        const parsed = JSON.parse(cachedAccs) as Account[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAccounts((prev) => (prev.length === 0 ? parsed : prev));
        }
      }
    } catch { /* ignore */ }
    return () => { cancelled = true; };
  }, []);

  // Network fetch when user is ready
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const [{ data: accs }, { data: ems, error }] = await Promise.all([
        supabase.from("accounts").select("id,name,type,color,icon").order("created_at"),
        supabase
          .from("emails")
          .select("*")
          .eq("is_archived", false)
          .order("received_at", { ascending: false })
          .limit(1000),
      ]);

      if (cancelled) return;
      if (accs) {
        setAccounts(accs as Account[]);
        try { localStorage.setItem("inbox:accounts", JSON.stringify(accs)); } catch { /* ignore */ }
      }
      if (error) {
        if (emails.length === 0) toast.error("Hors-ligne : aucun cache disponible");
      } else if (ems) {
        setEmails(ems as Email[]);
        setUsingCache(false);
        cacheEmails(ems as Email[]);

        const hasPending = (ems as Email[]).some((e) => !e.ai_processed_at);
        if (hasPending) {
          (async () => {
            for (let i = 0; i < 6 && !cancelled; i++) {
              const res = await classifyFn().catch(() => ({ processed: 0 }));
              if (!res || res.processed === 0) break;
              const { data: refreshed } = await supabase
                .from("emails")
                .select("*")
                .eq("is_archived", false)
                .order("received_at", { ascending: false })
                .limit(1000);
              if (!cancelled && refreshed) {
                setEmails(refreshed as Email[]);
                cacheEmails(refreshed as Email[]);
              }
            }
          })();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  // Fetch OneDrive folders (best effort) to enrich smart groups
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await odFoldersFn();
        if (cancelled || !res?.folders) return;
        const slim = res.folders.map((f) => ({ name: f.name, path: f.path, depth: f.depth }));
        try { localStorage.setItem("inbox:odFolders", JSON.stringify(slim)); } catch { /* ignore */ }
        setOdGroups(smartGroupsFromFolders(slim));
      } catch {
        /* OneDrive not connected or transient error — ignore silently */
      }
    })();
    return () => { cancelled = true; };
  }, [user, odFoldersFn]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  // OneDrive folder themes first (they drive the classification),
  // built-in fallback groups (Prestataires IT, Infos commerciales) last.
  const allSmartGroups = useMemo(() => [...odGroups, ...SMART_GROUPS], [odGroups]);

  const counts = useMemo(() => {
    const unread = emails.filter((e) => !e.is_read).length;
    const attachments = emails.filter((e) => e.has_attachment).length;
    const starred = emails.filter((e) => e.is_starred).length;
    const byAccount = new Map<string, number>();
    emails.forEach((e) => byAccount.set(e.account_id, (byAccount.get(e.account_id) ?? 0) + 1));
    const bySmart = countByGroup(emails, odGroups);
    return { all: emails.length, unread, attachments, starred, byAccount, bySmart };
  }, [emails, odGroups]);

  const filtered = useMemo(() => {
    let list = emails;
    if (filter === "unread") list = list.filter((e) => !e.is_read);
    else if (filter === "attachments") list = list.filter((e) => e.has_attachment);
    else if (filter === "starred") list = list.filter((e) => e.is_starred);
    else if (filter.startsWith("account:")) {
      const id = filter.slice(8);
      list = list.filter((e) => e.account_id === id);
    } else if (filter.startsWith("smart:")) {
      const key = filter.slice(6);
      list = list.filter((e) => classifyEmail(e, odGroups) === key);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          (e.subject ?? "").toLowerCase().includes(q) ||
          (e.from_address ?? "").toLowerCase().includes(q) ||
          (e.from_name ?? "").toLowerCase().includes(q) ||
          (e.body_text ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [emails, filter, query]);

  const selected = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId],
  );

  // Auto-sélectionne le dernier mail de la liste filtrée si rien n'est sélectionné
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  // Mutations (optimistic)
  const patch = async (id: string, updates: Partial<Email>) => {
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    const { error } = await supabase.from("emails").update(updates).eq("id", id);
    if (error) toast.error(error.message);
  };

  const toggleRead = (e: Email) => patch(e.id, { is_read: !e.is_read });
  const toggleStar = (e: Email) => patch(e.id, { is_starred: !e.is_starred });
  const archive = async (e: Email) => {
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase.from("emails").update({ is_archived: true }).eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Email archivé");
  };
  const remove = async (e: Email) => {
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase.from("emails").delete().eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Email supprimé");
  };

  const postponeAsTask = async (e: Email) => {
    const labels = Array.from(new Set([...(e.labels ?? []), "task-todo"]));
    setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, labels } : x)));
    const { error } = await supabase.from("emails").update({ labels }).eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Ajouté aux demandes de tâches à traiter");
  };

  // Bulk actions on `checked`
  const bulkIds = () => Array.from(checked);
  const bulkArchive = async () => {
    const ids = bulkIds(); if (!ids.length) return;
    setEmails((prev) => prev.filter((x) => !checked.has(x.id)));
    if (selectedId && checked.has(selectedId)) setSelectedId(null);
    clearChecked();
    const { error } = await supabase.from("emails").update({ is_archived: true }).in("id", ids);
    if (error) toast.error(error.message); else toast.success(`${ids.length} email(s) archivé(s)`);
  };
  const bulkDelete = async () => {
    const ids = bulkIds(); if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} email(s) ?`)) return;
    setEmails((prev) => prev.filter((x) => !checked.has(x.id)));
    if (selectedId && checked.has(selectedId)) setSelectedId(null);
    clearChecked();
    const { error } = await supabase.from("emails").delete().in("id", ids);
    if (error) toast.error(error.message); else toast.success(`${ids.length} email(s) supprimé(s)`);
  };
  const bulkMarkRead = async (read: boolean) => {
    const ids = bulkIds(); if (!ids.length) return;
    setEmails((prev) => prev.map((x) => (checked.has(x.id) ? { ...x, is_read: read } : x)));
    clearChecked();
    const { error } = await supabase.from("emails").update({ is_read: read }).in("id", ids);
    if (error) toast.error(error.message);
  };


  const openEmail = (e: Email) => {
    setSelectedId(e.id);
    if (!e.is_read) patch(e.id, { is_read: true });
  };

  return (
    <div className="-mx-3 -my-3 flex h-[calc(100vh-3.5rem)] overflow-hidden sm:-mx-4 sm:-my-4 sm:h-[calc(100vh-4rem)] md:-mx-6">
      {/* LEFT — filters */}
      <aside style={{ width: leftW }} className="hidden shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center gap-2">
            <InboxIcon className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-semibold">Boîte unifiée</h1>
            {offline && (
              <Badge variant="secondary" className="ml-auto gap-1 text-[10px]">
                <Zap className="h-3 w-3" /> Cache local
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 text-sm">
          <FilterRow label="Tous les mails" icon={<Mail className="h-4 w-4" />} count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterRow label="Non lus" icon={<Circle className="h-4 w-4 fill-current" />} count={counts.unread} active={filter === "unread"} onClick={() => setFilter("unread")} />
          <FilterRow label="Pièces jointes" icon={<Paperclip className="h-4 w-4" />} count={counts.attachments} active={filter === "attachments"} onClick={() => setFilter("attachments")} />
          <FilterRow label="Suivis" icon={<Star className="h-4 w-4" />} count={counts.starred} active={filter === "starred"} onClick={() => setFilter("starred")} />

          <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="mr-1 inline h-3 w-3" />
            Analyse intelligente
          </div>
          {allSmartGroups.every((g) => (counts.bySmart.get(g.key) ?? 0) === 0) && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Aucun thème détecté pour l'instant.
            </div>
          )}
          {allSmartGroups.map((g) => {
            const n = counts.bySmart.get(g.key) ?? 0;
            if (n === 0) return null;
            const active = filter === `smart:${g.key}`;
            return (
              <button
                key={g.key}
                onClick={() => setFilter(`smart:${g.key}`)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/50",
                )}
                title={g.label}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-xs">
                  {g.icon}
                </span>
                <span className="flex-1 truncate text-sm">{g.label}</span>
                <span className="text-[11px] text-muted-foreground">{n}</span>
              </button>
            );
          })}

          <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comptes
          </div>
          {accounts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Aucun compte configuré.</div>
          )}
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setFilter(`account:${a.id}`)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                filter === `account:${a.id}` ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded text-xs"
                style={{ background: a.color ?? "#64748b", color: "#fff" }}
              >
                {a.icon ?? "✉️"}
              </span>
              <span className="flex-1 truncate text-sm">{a.name}</span>
              <span className="text-[11px] text-muted-foreground">{counts.byAccount.get(a.id) ?? 0}</span>
            </button>
          ))}
          {!accounts.some((a) => a.name === "CHU" || a.type === "imap") && (
            <QuickAddOvh onAdded={() => setReloadKey((k) => k + 1)} />
          )}
        </nav>

        {usingCache && (
          <div className="border-t bg-amber-500/10 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <Zap className="mr-1 inline h-3 w-3" /> Données chargées depuis le cache local
          </div>
        )}
      </aside>
      {/* left resizer */}
      <div
        onMouseDown={startDrag("left")}
        className="hidden w-1 shrink-0 cursor-col-resize bg-border/30 hover:bg-primary/40 md:block"
        title="Glisser pour redimensionner"
      />

      {/* CENTER — list */}
      <section className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-3">
            <Select
              value={filter.startsWith("account:") ? filter : "all"}
              onValueChange={(v) => setFilter(v as Filter)}
            >
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1 text-xs font-medium text-foreground hover:bg-accent/50 focus:ring-0 [&>svg]:hidden">
                <SelectValue placeholder="Tous les comptes" />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    Tous les comptes
                    <span className="ml-auto text-[10px] text-muted-foreground">{counts.all}</span>
                  </div>
                </SelectItem>
                <SelectItem value="unread" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Circle className="h-3.5 w-3.5 fill-current text-muted-foreground" />
                    Non lus
                    <span className="ml-auto text-[10px] text-muted-foreground">{counts.unread}</span>
                  </div>
                </SelectItem>
                <SelectItem value="starred" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 text-amber-400" />
                    Suivis
                    <span className="ml-auto text-[10px] text-muted-foreground">{counts.starred}</span>
                  </div>
                </SelectItem>
                <SelectItem value="attachments" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    Pièces jointes
                    <span className="ml-auto text-[10px] text-muted-foreground">{counts.attachments}</span>
                  </div>
                </SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={`account:${a.id}`} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: a.color ?? "#64748b" }}
                      />
                      {a.name}
                      <span className="ml-auto text-[10px] text-muted-foreground">{counts.byAccount.get(a.id) ?? 0}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length} email{filtered.length > 1 ? "s" : ""}</span>
        </div>
        <div className={cn(
          "flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-xs",
          checked.size > 0 ? "bg-primary/5" : "bg-muted/30"
        )}>
          <input
            type="checkbox"
            checked={filtered.length > 0 && filtered.every((e) => checked.has(e.id))}
            ref={(el) => {
              if (el) el.indeterminate = checked.size > 0 && !(filtered.length > 0 && filtered.every((e) => checked.has(e.id)));
            }}
            onChange={(ev) => {
              if (ev.target.checked) setChecked(new Set(filtered.map((e) => e.id)));
              else clearChecked();
            }}
            className="h-3.5 w-3.5 cursor-pointer"
            title="Tout sélectionner"
            disabled={filtered.length === 0}
          />
          {checked.size > 0 ? (
            <>
              <span className="font-medium">{checked.size} sélectionné{checked.size > 1 ? "s" : ""}</span>
              <div className="ml-auto flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={() => bulkMarkRead(true)}>
                  <MailOpen className="h-3.5 w-3.5" /> Lu
                </Button>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={() => bulkMarkRead(false)}>
                  <Mail className="h-3.5 w-3.5" /> Non lu
                </Button>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={bulkArchive}>
                  <Archive className="h-3.5 w-3.5" /> Archiver
                </Button>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-destructive hover:text-destructive" onClick={bulkDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={clearChecked}>Annuler</Button>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">Sélectionner pour actions groupées</span>
          )}
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {filtered.length === 0 && (
            <li className="p-10 text-center text-sm text-muted-foreground">
              {emails.length === 0 ? "Aucun email — configurez un compte dans Paramètres." : "Aucun résultat."}
            </li>
          )}
          {filtered.map((e) => {
            const acc = accountById.get(e.account_id);
            const isSel = e.id === selectedId;
            return (
              <li
                key={e.id}
                onClick={() => openEmail(e)}
                className={cn(
                  "group relative cursor-pointer px-3 py-2.5 transition-colors",
                  isSel ? "bg-accent" : "hover:bg-accent/50",
                  !e.is_read && "bg-primary/[0.03]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={checked.has(e.id)}
                    onChange={() => {}}
                    onClick={(ev) => toggleCheck(e.id, ev)}
                    className={cn(
                      "mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer",
                      checked.has(e.id) ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                    )}
                    title="Sélectionner"
                  />
                  <span
                    className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: acc?.color ?? "#64748b" }}
                    title={acc?.name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", priorityDotClass(e.ai_priority))}
                        title={e.ai_priority ? `Priorité IA : ${e.ai_priority}` : "Priorité non analysée"}
                      />
                      <span className={cn("truncate text-sm", !e.is_read && "font-semibold")}>
                        {e.from_name || e.from_address || "Inconnu"}
                      </span>
                      <span className="ml-auto shrink-0 text-right text-[11px] text-muted-foreground leading-tight">
                        <div>{relativeTime(e.received_at)}</div>
                        {e.received_at && (
                          <div className="text-[10px] opacity-75">
                            {new Date(e.received_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })} · {new Date(e.received_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </span>
                    </div>
                    <div className={cn("truncate text-sm", !e.is_read ? "font-semibold" : "text-foreground/80")}>
                      {e.subject || "(sans objet)"}
                    </div>
                    {e.ai_summary ? (
                      <div className="mt-0.5 flex items-start gap-1 text-xs italic text-muted-foreground">
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                        <span className="line-clamp-2">{e.ai_summary}</span>
                      </div>
                    ) : (
                      <div className="truncate text-xs text-muted-foreground">
                        {(e.body_text ?? "").replace(/\s+/g, " ").slice(0, 120)}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                      {e.is_sensitive && (
                        <span
                          className="flex items-center gap-0.5 rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-600 dark:text-red-400"
                          title={e.sensitive_reason ?? "Données de santé détectées"}
                        >
                          <Lock className="h-2.5 w-2.5" /> Sensible
                        </span>
                      )}
                      {e.is_starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      {e.has_attachment && <Paperclip className="h-3 w-3" />}
                      {e.ai_category && !e.is_sensitive && (
                        <span className="flex items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] text-primary">
                          {categoryLabel(e.ai_category)}
                        </span>
                      )}
                      {(e.labels ?? []).slice(0, 2).map((l) => (
                        <span key={l} className="flex items-center gap-0.5 text-[10px]">
                          <Tag className="h-2.5 w-2.5" /> {l}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* hover actions */}
                <div className="absolute right-2 top-2 hidden gap-1 rounded-md border bg-background p-0.5 shadow-sm group-hover:flex">
                  <IconBtn label={e.is_read ? "Marquer non lu" : "Marquer lu"} onClick={(ev) => { ev.stopPropagation(); toggleRead(e); }}>
                    {e.is_read ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                  </IconBtn>
                  <IconBtn label="Supprimer" onClick={(ev) => { ev.stopPropagation(); remove(e); }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </IconBtn>
                  <IconBtn label="Étoiler" onClick={(ev) => { ev.stopPropagation(); toggleStar(e); }}>
                    <Star className={cn("h-3.5 w-3.5", e.is_starred && "fill-amber-400 text-amber-400")} />
                  </IconBtn>
                  <IconBtn label="Archiver" onClick={(ev) => { ev.stopPropagation(); archive(e); }}>
                    <Archive className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label="Créer une tâche" onClick={(ev) => { ev.stopPropagation(); setSelectedId(e.id); setTaskOpen(true); }}>
                    <Plus className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label="Reporter en tâche à traiter" onClick={(ev) => { ev.stopPropagation(); postponeAsTask(e); }}>
                    <Clock className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* right resizer */}
      <div
        onMouseDown={startDrag("right")}
        className="hidden w-1 shrink-0 cursor-col-resize bg-border/30 hover:bg-primary/40 lg:block"
        title="Glisser pour redimensionner"
      />

      {/* RIGHT — reader (full overlay on mobile when selected) */}
      <aside
        style={{
          width: typeof window !== "undefined" && window.innerWidth >= 1024
            ? Math.min(rightW, Math.max(360, window.innerWidth - leftW - 380))
            : undefined,
        }}
        className={cn(
          "min-w-0 shrink-0 flex-col bg-card lg:flex lg:relative lg:inset-auto lg:z-auto",
          selected ? "fixed inset-0 z-40 flex" : "hidden lg:flex",
        )}
      >
        {selected && (
          <button
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1 border-b px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent lg:hidden"
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-90" /> Retour à la liste
          </button>
        )}
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Sélectionnez un email pour le lire
          </div>
        ) : (
          <Reader
            email={selected}
            account={accountById.get(selected.account_id)}
            userId={user?.id ?? ""}
            onStar={() => toggleStar(selected)}
            onArchive={() => archive(selected)}
            onDelete={() => remove(selected)}
            onCreateTask={() => setTaskOpen(true)}
            onPostpone={() => postponeAsTask(selected)}
          />
        )}
      </aside>


      {selected && (
        <CreateTaskFromEmailDialog
          open={taskOpen}
          onOpenChange={setTaskOpen}
          email={selected}
          userId={user?.id ?? ""}
        />
      )}
    </div>
  );
}

function FilterRow({ label, icon, count, active, onClick }: { label: string; icon: React.ReactNode; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Reader({
  email,
  account,
  userId,
  onStar,
  onArchive,
  onDelete,
  onCreateTask,
  onPostpone,
}: {
  email: Email;
  account?: Account;
  userId: string;
  onStar: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
  onPostpone: () => void;
}) {
  const isPostponed = (email.labels ?? []).includes("task-todo");
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <header className="border-b p-4">
        <div className="mb-2 flex items-center gap-2">
          {account && (
            <Badge style={{ background: account.color ?? "#64748b", color: "#fff" }} className="border-0">
              {account.icon} {account.name}
            </Badge>
          )}
          <button onClick={onStar} className="ml-auto text-muted-foreground hover:text-amber-400">
            <Star className={cn("h-4 w-4", email.is_starred && "fill-amber-400 text-amber-400")} />
          </button>
        </div>
        <h2 className="text-base font-semibold">{email.subject || "(sans objet)"}</h2>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">De :</span> {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</div>
          <div><span className="font-medium text-foreground">À :</span> {email.to_address}</div>
          <div><span className="font-medium text-foreground">Date :</span> {email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : ""}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1"><Reply className="h-3 w-3" /> Répondre</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1"><ReplyAll className="h-3 w-3" /> Tous</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1"><Forward className="h-3 w-3" /> Transférer</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onArchive}><Archive className="h-3 w-3" /> Archiver</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /> Suppr.</Button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" className="gap-1" onClick={onCreateTask}>
            <Plus className="h-3.5 w-3.5" /> Créer une tâche
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={onPostpone}
            disabled={isPostponed}
          >
            <Clock className="h-3.5 w-3.5" />
            {isPostponed ? "Déjà reportée" : "Reporter (à traiter)"}
          </Button>
        </div>
      </header>

      {email.is_sensitive ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Email marqué sensible (HDS)</div>
              <div className="mt-0.5 opacity-90">
                Données de santé potentielles détectées : {email.sensitive_reason ?? "motif inconnu"}.
                Aucune analyse IA n'est effectuée sur ce message.
              </div>
            </div>
          </div>
          <VaultActions email={email} onMoved={onArchive} />
        </div>
      ) : (
        <AiClassificationFeedback
          emailId={email.id}
          priority={email.ai_priority}
          category={email.ai_category}
          onUpdated={() => { /* cache will refresh on next sync */ }}
        />
      )}

      {email.has_attachment && (
        <EmailAttachmentsPanel
          emailId={email.id}
          fromAddress={email.from_address}
          subject={email.subject}
        />
      )}

      {!email.is_sensitive && (
        <AiSuggestionsPanel
          emailId={email.id}
          fromAddress={email.from_address}
          subject={email.subject}
          userId={userId}
          onCreateTask={() => onCreateTask()}
          onArchive={onArchive}
        />
      )}

      <div className="min-w-0 p-4 text-sm">
        {email.body_html ? (
          <div
            className="prose prose-sm max-w-none break-words dark:prose-invert [&_img]:max-w-full [&_table]:max-w-full"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{email.body_text ?? "(vide)"}</pre>
        )}
      </div>
    </div>
  );
}



function priorityDotClass(p: string | null | undefined): string {
  switch (p) {
    case "urgent": return "bg-red-500";
    case "important": return "bg-orange-500";
    case "normal": return "bg-yellow-400";
    case "low": return "bg-green-500";
    default: return "bg-muted-foreground/30";
  }
}

function categoryLabel(c: string | null | undefined): string {
  switch (c) {
    case "action": return "📋 Action";
    case "rendez-vous": return "📅 RDV";
    case "document": return "📄 Doc";
    case "facturation": return "💰 Facture";
    case "rh": return "👥 RH";
    case "info": return "📣 Info";
    case "newsletter": return "🗑️ Newsletter";
    default: return c ?? "";
  }
}

function VaultActions({ email, onMoved }: { email: Email; onMoved: () => void }) {
  const { unlocked, initialized, key } = useSecureVault();
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function moveToVault() {
    if (!key) return;
    setBusy(true);
    try {
      const { putEmail } = await import("@/lib/secure-vault");
      await putEmail(key, {
        id: email.id,
        from_address: email.from_address,
        from_name: email.from_name,
        to_address: email.to_address,
        subject: email.subject,
        body_text: email.body_text,
        body_html: email.body_html,
        received_at: email.received_at,
        sensitive_reason: email.sensitive_reason ?? null,
        sensitive_score: email.sensitive_score ?? null,
      });
      // Supprimer du cloud après mise au coffre (le message reste sur l'IMAP source).
      await supabase.from("emails").delete().eq("id", email.id);
      toast.success("Email déplacé dans le coffre local chiffré");
      onMoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unlocked ? (
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={moveToVault} disabled={busy}>
          <Lock className="h-3 w-3" /> Mettre au coffre
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setPinOpen(true)}>
          <Lock className="h-3 w-3" /> {initialized ? "Déverrouiller le coffre" : "Créer le coffre"}
        </Button>
      )}
      <VaultPinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </div>
  );
}
