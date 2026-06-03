import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
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
  ChevronRight,
  Sparkles,
  Check,
  Lock,
  Shield,
  ShieldAlert,
  ShieldOff,
  Megaphone,
  Settings2,
  RefreshCw,
  Loader2,
  Undo2,
  FolderInput,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import {
  listThemes,
  classifyPendingThemes,
  discoverThemes,
  seedThemesFromFolders,
  setEmailTheme,
  type Theme,
} from "@/lib/api/themes.functions";
import { listOneDriveFolders } from "@/lib/api/onedrive.functions";
import { ThemesManagerDialog, EmailThemePicker } from "@/components/inbox/themes-manager-dialog";
import { EmailComposer, type ComposerInitial } from "@/components/inbox/email-composer";
import { SwipeableRow, type SwipeAction } from "@/components/inbox/swipeable-row";
import { useDeleteKey } from "@/hooks/use-delete-key";

type Account = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
  credentials: Record<string, unknown> | null;
};

type Email = CachedEmail;

type Filter =
  | "all"
  | "unread"
  | "attachments"
  | "starred"
  | "spam"
  | "promo"
  | "trash"
  | `account:${string}`
  | `theme:${string}`
  | "theme:__none__";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

const PARENT_SEPARATORS = [" / ", " > ", " – ", " — ", " : ", " - "];
function splitThemeName(name: string): { parent: string; child: string } | null {
  for (const sep of PARENT_SEPARATORS) {
    const i = name.indexOf(sep);
    if (i > 0) {
      return { parent: name.slice(0, i).trim(), child: name.slice(i + sep.length).trim() };
    }
  }
  return null;
}

function groupThemes(
  themes: Theme[],
  byTheme: Map<string, number>,
): {
  grouped: { name: string; items: { theme: Theme; label: string }[]; total: number }[];
  standalone: Theme[];
} {
  const active = themes.filter((t) => !t.archived_at && (byTheme.get(t.id) ?? 0) > 0);
  const map = new Map<string, { theme: Theme; label: string }[]>();
  const flat: Theme[] = [];
  for (const t of active) {
    const parsed = splitThemeName(t.name);
    if (parsed) {
      const arr = map.get(parsed.parent) ?? [];
      arr.push({ theme: t, label: parsed.child });
      map.set(parsed.parent, arr);
    } else {
      flat.push(t);
    }
  }
  // Try to group remaining by significant first word (>=4 chars) if 2+ share it
  const byFirst = new Map<string, Theme[]>();
  for (const t of flat) {
    const first = t.name.split(/\s+/)[0]?.trim() ?? "";
    if (first.length >= 4) {
      const arr = byFirst.get(first) ?? [];
      arr.push(t);
      byFirst.set(first, arr);
    }
  }
  const standalone: Theme[] = [];
  const usedIds = new Set<string>();
  for (const [first, arr] of byFirst) {
    if (arr.length >= 2) {
      const existing = map.get(first) ?? [];
      for (const t of arr) {
        existing.push({ theme: t, label: t.name });
        usedIds.add(t.id);
      }
      map.set(first, existing);
    }
  }
  for (const t of flat) if (!usedIds.has(t.id)) standalone.push(t);

  const grouped = [...map.entries()]
    .map(([name, items]) => ({
      name,
      items: items.sort((a, b) => (byTheme.get(b.theme.id) ?? 0) - (byTheme.get(a.theme.id) ?? 0)),
      total: items.reduce((s, i) => s + (byTheme.get(i.theme.id) ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return { grouped, standalone };
}

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
  // Bug 1 fix : snapshot des IDs non-lus quand on entre dans la vue "Non lus"
  // pour que les mails ouverts (et passés is_read=true) ne disparaissent pas
  // de la liste tant qu'on reste sur la vue.
  const [unreadSnapshot, setUnreadSnapshot] = useState<Set<string> | null>(null);
  const classifyFn = useServerFn(classifyPendingEmails);
  const odFoldersFn = useServerFn(listOneDriveFolders);
  const listThemesFn = useServerFn(listThemes);
  const classifyThemesFn = useServerFn(classifyPendingThemes);
  const discoverThemesFn = useServerFn(discoverThemes);
  const seedFoldersFn = useServerFn(seedThemesFromFolders);
  const setEmailThemeFn = useServerFn(setEmailTheme);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesOpen, setThemesOpen] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [aiRanking, setAiRanking] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<ComposerInitial>({ mode: "new" });
  const [undoStack, setUndoStack] = useState<{ label: string; run: () => Promise<void> | void }[]>([]);
  const pushUndo = (entry: { label: string; run: () => Promise<void> | void }) =>
    setUndoStack((s) => [...s.slice(-9), entry]);
  const runUndo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    try { await last.run(); } catch (e) { toast.error(e instanceof Error ? e.message : "Annulation impossible"); }
  };

  const openComposer = (init: ComposerInitial) => {
    setComposerInitial(init);
    setComposerOpen(true);
  };

  const buildReplyInit = (e: Email, all = false): ComposerInitial => {
    const dateStr = e.received_at ? new Date(e.received_at).toLocaleString("fr-FR") : "";
    const sender = e.from_name ? `${e.from_name} <${e.from_address}>` : (e.from_address ?? "");
    const quoted =
      "\n\n\nLe " +
      dateStr +
      ", " +
      sender +
      " a écrit :\n" +
      (e.body_text ?? "")
        .split("\n")
        .map((l) => "> " + l)
        .join("\n");
    const refs = e.message_id ? `<${e.message_id}>` : undefined;
    const subj = e.subject?.startsWith("Re:") ? e.subject : `Re: ${e.subject ?? ""}`;
    return {
      mode: all ? "replyAll" : "reply",
      defaultAccountId: e.account_id,
      to: e.from_address ?? "",
      cc: all ? (e.to_address ?? "") : undefined,
      subject: subj,
      body: quoted,
      inReplyTo: refs,
      references: refs,
    };
  };
  const buildForwardInit = (e: Email): ComposerInitial => {
    const subj = e.subject?.startsWith("Fwd:") ? e.subject : `Fwd: ${e.subject ?? ""}`;
    return {
      mode: "forward",
      defaultAccountId: e.account_id,
      subject: subj,
      body: `\n\n---------- Message transféré ----------\nDe: ${e.from_name ?? ""} <${e.from_address ?? ""}>\nDate: ${e.received_at ?? ""}\nSujet: ${e.subject ?? ""}\nÀ: ${e.to_address ?? ""}\n\n${e.body_text ?? ""}`,
    };
  };

  const relaunchAi = async () => {
    if (relaunching) return;
    setRelaunching(true);
    try {
      let totalProcessed = 0;
      for (let i = 0; i < 12; i++) {
        const r = await classifyThemesFn().catch(() => ({ processed: 0 }));
        if (!r || r.processed === 0) break;
        totalProcessed += r.processed;
      }
      await refreshThemes();
      const { data: refreshed } = await supabase
        .from("emails")
        .select("*")
        .eq("is_archived", false)
        .order("received_at", { ascending: false })
        .limit(1000);
      if (refreshed) {
        setEmails(refreshed as Email[]);
        cacheEmails(refreshed as Email[]);
      }
      toast.success(
        totalProcessed > 0 ? `${totalProcessed} email(s) reclassé(s)` : "Aucun email à reclasser",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors du relancement");
    } finally {
      setRelaunching(false);
    }
  };

  const toggleCheck = (id: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearChecked = () => setChecked(new Set());

  // Resizable column widths (persisted)
  const [leftW, setLeftW] = useState<number>(() => {
    if (typeof window === "undefined") return 280;
    const v = Number(localStorage.getItem("inbox:leftW"));
    return v >= 200 && v <= 500 ? v : 280;
  });
  const [rightW, setRightW] = useState<number>(() => {
    if (typeof window === "undefined") return 600;
    const v = Number(localStorage.getItem("inbox:rightW"));
    return v >= 320 ? v : 600;
  });
  const [winW, setWinW] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 600,
  );

  const isMobileInbox = winW < 1024;
  const [readerOpen, setReaderOpen] = useState(false);
  // Mobile navigation: 'sidebar' (boîtes / thèmes IA) ↔ 'list' (liste des mails)
  const [mobileView, setMobileView] = useState<"sidebar" | "list">("sidebar");
  const mobileViewInitRef = useRef(true);

  // Quand l'utilisateur change de filtre / boîte / thème depuis la sidebar mobile,
  // on bascule sur la liste et on empile une entrée d'historique pour que la
  // flèche « retour » revienne à la sidebar plutôt que de quitter la page.
  useEffect(() => {
    if (mobileViewInitRef.current) {
      mobileViewInitRef.current = false;
      return;
    }
    if (!isMobileInbox) return;
    if (mobileView === "list") return;
    setMobileView("list");
    try {
      window.history.pushState({ inboxList: true }, "");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Bouton « retour » natif depuis la liste mobile → revenir à la sidebar.
  useEffect(() => {
    if (!isMobileInbox) return;
    if (mobileView !== "list") return;
    if (readerOpen) return; // le popstate du lecteur a la priorité
    const onPop = () => setMobileView("sidebar");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isMobileInbox, mobileView, readerOpen]);

  // Si on repasse en desktop, on s'assure que tout est visible.
  useEffect(() => {
    if (!isMobileInbox) setMobileView("list");
  }, [isMobileInbox]);
  useEffect(() => {
    // Sync immédiatement après hydratation (SSR peut renvoyer 1280 par défaut)
    setWinW(window.innerWidth);
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
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
        const maxW = Math.max(360, window.innerWidth - leftW - 380);
        const w = Math.min(maxW, Math.max(320, startW - dx));
        setRightW(w);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      localStorage.setItem(
        "inbox:leftW",
        String(which === "left" ? (document.documentElement.dataset._lw ?? leftW) : leftW),
      );
      localStorage.setItem(
        "inbox:rightW",
        String(which === "right" ? (document.documentElement.dataset._rw ?? rightW) : rightW),
      );
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => {
    localStorage.setItem("inbox:leftW", String(leftW));
  }, [leftW]);
  useEffect(() => {
    localStorage.setItem("inbox:rightW", String(rightW));
  }, [rightW]);

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
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Network fetch when user is ready
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const [{ data: accs }, { data: ems, error }] = await Promise.all([
        supabase.from("accounts").select("id,name,type,color,icon,credentials").order("created_at"),
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
        try {
          localStorage.setItem("inbox:accounts", JSON.stringify(accs));
        } catch {
          /* ignore */
        }
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

  useEffect(() => {
    const onSynced = () => setReloadKey((k) => k + 1);
    window.addEventListener("emails-synced", onSynced);
    return () => window.removeEventListener("emails-synced", onSynced);
  }, []);

  // Load themes from DB + bootstrap (discover + seed from OneDrive) on first run
  const refreshThemes = async () => {
    const r = await listThemesFn().catch(() => ({ themes: [] as Theme[] }));
    setThemes(r.themes);
    return r.themes;
  };




  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const current = await refreshThemes();
      if (cancelled) return;

      // Bootstrap: if no themes yet, seed from OneDrive folders + discover via AI
      if (current.length === 0) {
        try {
          const od = await odFoldersFn();
          if (!cancelled && od?.folders?.length) {
            const slim = od.folders.map((f) => ({ name: f.name, path: f.path, depth: f.depth }));
            await seedFoldersFn({ data: { folders: slim } });
          }
        } catch {
          /* onedrive optional */
        }
        if (!cancelled) {
          await discoverThemesFn().catch(() => null);
          await refreshThemes();
        }
      }

      // Background: classify pending emails into themes
      for (let i = 0; i < 8 && !cancelled; i++) {
        const r = await classifyThemesFn().catch(() => ({ processed: 0 }));
        if (!r || r.processed === 0) break;
        if (!cancelled) await refreshThemes();
        // Refresh emails list to pick up new ai_theme_id
        const { data: refreshed } = await supabase
          .from("emails")
          .select("*")
          .eq("is_archived", false)
          .order("received_at", { ascending: false })
          .limit(1000);
        if (!cancelled && refreshed) setEmails(refreshed as Email[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const themeById = useMemo(() => {
    const m = new Map<string, Theme>();
    themes.forEach((t) => m.set(t.id, t));
    return m;
  }, [themes]);

  const isSpam = (e: Email) => e.spam_label === "spam" || e.spam_label === "phishing";
  const isPromo = (e: Email) => e.spam_label === "promo";
  const isTrashed = (e: Email) => !!e.deleted_at;

  const counts = useMemo(() => {
    const live = emails.filter((e) => !isTrashed(e));
    const inboxEmails = live.filter((e) => !isSpam(e) && !isPromo(e));
    const unread = live.filter((e) => !e.is_read).length;
    const attachments = live.filter((e) => e.has_attachment).length;
    const starred = live.filter((e) => e.is_starred).length;
    const spam = live.filter(isSpam).length;
    const promo = live.filter(isPromo).length;
    const trash = emails.filter(isTrashed).length;
    const byAccount = new Map<string, number>();
    live.forEach((e) => byAccount.set(e.account_id, (byAccount.get(e.account_id) ?? 0) + 1));
    const byTheme = new Map<string, number>();
    let noTheme = 0;
    inboxEmails.forEach((e) => {
      if (e.ai_theme_id) byTheme.set(e.ai_theme_id, (byTheme.get(e.ai_theme_id) ?? 0) + 1);
      else noTheme++;
    });
    return {
      all: live.length,
      unread,
      attachments,
      starred,
      spam,
      promo,
      trash,
      byAccount,
      byTheme,
      noTheme,
    };
  }, [emails]);

  const filtered = useMemo(() => {
    let list = emails;
    if (filter === "trash") {
      list = list.filter(isTrashed);
    } else {
      list = list.filter((e) => !isTrashed(e));
      if (filter.startsWith("account:")) {
        const id = filter.slice(8);
        list = list.filter((e) => e.account_id === id);
      } else if (filter === "spam") list = list.filter(isSpam);
      else if (filter === "promo") list = list.filter(isPromo);
      else if (filter === "all") {
        // Tous les mails : aucun filtre IA (spam/promo inclus)
        if (false) list = list;
      } else {
        list = list.filter((e) => !isSpam(e) && !isPromo(e));
        if (filter === "unread") {
          // Garde visibles les mails non-lus au moment d'entrer dans la vue,
          // même si on les ouvre (is_read=true). Les nouveaux non-lus s'ajoutent.
          list = list.filter((e) =>
            unreadSnapshot ? unreadSnapshot.has(e.id) || !e.is_read : !e.is_read,
          );
        }
        else if (filter === "attachments") list = list.filter((e) => e.has_attachment);
        else if (filter === "starred") list = list.filter((e) => e.is_starred);
        else if (filter === "theme:__none__") list = list.filter((e) => !e.ai_theme_id);
        else if (filter.startsWith("theme:")) {
          const id = filter.slice(6);
          list = list.filter((e) => e.ai_theme_id === id);
        }
      }
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
  }, [emails, filter, query, unreadSnapshot]);

  // Bug 1 fix : capture/relâche le snapshot des non-lus selon la vue active.
  useEffect(() => {
    if (filter === "unread") {
      setUnreadSnapshot(
        new Set(emails.filter((e) => !e.is_read && !e.deleted_at).map((e) => e.id)),
      );
    } else {
      setUnreadSnapshot(null);
    }
    // On capture une seule fois à l'entrée dans la vue ; les nouveaux non-lus
    // s'affichent grâce à la condition || !e.is_read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Classement IA : regroupe la liste filtrée par thème, thèmes triés par
  // date du mail le plus récent. Émet une séquence d'entrées (en-tête + emails).
  type RenderItem =
    | { kind: "header"; key: string; label: string; count: number; ids: string[] }
    | { kind: "email"; email: Email };
  const [collapsedThemes, setCollapsedThemes] = useState<Set<string>>(new Set());
  const toggleTheme = (key: string) =>
    setCollapsedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const displayItems = useMemo<RenderItem[]>(() => {
    if (!aiRanking) return filtered.map((e) => ({ kind: "email" as const, email: e }));
    const groups = new Map<string, { ts: number; emails: Email[] }>();
    const NO_THEME = "__none__";
    for (const e of filtered) {
      const key = e.ai_theme_id ?? NO_THEME;
      const ts = e.received_at ? new Date(e.received_at).getTime() : 0;
      const g = groups.get(key);
      if (g) {
        g.emails.push(e);
        if (ts > g.ts) g.ts = ts;
      } else groups.set(key, { ts, emails: [e] });
    }
    // Pondération par utilité du thème : fort > modéré > faible.
    // Les thèmes "faible" (ex. commerciaux/newsletters) sont rétrogradés
    // sous les thèmes utiles, même s'ils contiennent des mails plus récents.
    const utilityRank: Record<string, number> = { fort: 3, modere: 2, faible: 1 };
    const ordered = [...groups.entries()].sort((a, b) => {
      if (a[0] === NO_THEME) return 1;
      if (b[0] === NO_THEME) return -1;
      const ta = themeById.get(a[0]);
      const tb = themeById.get(b[0]);
      const ua = utilityRank[ta?.utility_level ?? "modere"] ?? 2;
      const ub = utilityRank[tb?.utility_level ?? "modere"] ?? 2;
      if (ua !== ub) return ub - ua;
      return b[1].ts - a[1].ts;
    });
    const out: RenderItem[] = [];
    for (const [key, g] of ordered) {
      g.emails.sort(
        (a, b) =>
          (b.received_at ? new Date(b.received_at).getTime() : 0) -
          (a.received_at ? new Date(a.received_at).getTime() : 0),
      );
      const t = key === NO_THEME ? null : themeById.get(key);
      const collapsed = collapsedThemes.has(key);
      out.push({
        kind: "header",
        key,
        label: t?.name ?? "Sans thème",
        count: g.emails.length,
        ids: g.emails.map((e) => e.id),
      });
      if (!collapsed) for (const e of g.emails) out.push({ kind: "email", email: e });
    }
    return out;
  }, [filtered, aiRanking, themeById, collapsedThemes]);

  const selected = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId],
  );

  // Touche Suppr : supprime l'email sélectionné
  useDeleteKey(!!selected, () => { if (selected) remove(selected); });

  // Quand le filtre change, sur mobile on revient à la liste ; sur desktop on garde le panneau de lecture rempli.
  useEffect(() => {
    if (isMobileInbox) {
      setReaderOpen(false);
      setSelectedId(null);
      return;
    }
    if (filtered.length > 0) {
      setSelectedId((prev) => {
        if (prev && filtered.some((e) => e.id === prev)) return prev;
        return filtered[0].id;
      });
    } else {
      setSelectedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, isMobileInbox]);

  // Fallback: si rien n'est sélectionné mais la liste est non vide
  // ⚠️ Uniquement sur desktop (≥1024) — sur mobile/tablette, l'utilisateur doit
  // choisir explicitement un email pour ouvrir le lecteur plein écran.
  useEffect(() => {
    if (isMobileInbox) return;
    if (filtered.length === 0) return;
    if (!selectedId || !filtered.some((e) => e.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, isMobileInbox, selectedId]);

  // Mutations (optimistic)
  const patch = async (id: string, updates: Partial<Email>) => {
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    const { error } = await supabase.from("emails").update(updates).eq("id", id);
    if (error) toast.error(error.message);
  };

  const toggleRead = (e: Email) => patch(e.id, { is_read: !e.is_read });
  const toggleStar = (e: Email) => patch(e.id, { is_starred: !e.is_starred });
  const archive = async (e: Email) => {
    const snapshot = e;
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase.from("emails").update({ is_archived: true }).eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Email archivé");
    pushUndo({
      label: "Archivage",
      run: async () => {
        const { error: err } = await supabase.from("emails").update({ is_archived: false }).eq("id", snapshot.id);
        if (err) throw new Error(err.message);
        setEmails((prev) => (prev.some((x) => x.id === snapshot.id) ? prev : [snapshot, ...prev]));
        toast.success("Archivage annulé");
      },
    });
  };
  const remove = async (e: Email) => {
    // Si déjà dans la corbeille → suppression définitive
    if (e.deleted_at) {
      if (!confirm("Supprimer définitivement cet email ?")) return;
      setEmails((prev) => prev.filter((x) => x.id !== e.id));
      if (selectedId === e.id) setSelectedId(null);
      const { error } = await supabase.from("emails").delete().eq("id", e.id);
      if (error) toast.error(error.message);
      else toast.success("Email supprimé définitivement");
      return;
    }
    // Sinon → corbeille (soft delete)
    const sender = (e.from_address ?? "").toLowerCase();
    const sameSenderIds = sender
      ? emails
          .filter(
            (x) =>
              !x.deleted_at &&
              (x.from_address ?? "").toLowerCase() === sender &&
              x.id !== e.id,
          )
          .map((x) => x.id)
      : [];
    let alsoDeleteSender = false;
    if (sameSenderIds.length > 0) {
      alsoDeleteSender = confirm(
        `Mettre aussi à la corbeille les ${sameSenderIds.length} autre(s) email(s) de ${e.from_name || e.from_address} ?`,
      );
    }
    const idsToDelete = alsoDeleteSender ? [e.id, ...sameSenderIds] : [e.id];
    const now = new Date().toISOString();
    setEmails((prev) =>
      prev.map((x) => (idsToDelete.includes(x.id) ? { ...x, deleted_at: now } : x)),
    );
    if (selectedId && idsToDelete.includes(selectedId)) setSelectedId(null);
    const { error } = await supabase
      .from("emails")
      .update({ deleted_at: now })
      .in("id", idsToDelete);
    if (error) { toast.error(error.message); return; }
    const undoTrash = async () => {
      const { error: err } = await supabase
        .from("emails")
        .update({ deleted_at: null })
        .in("id", idsToDelete);
      if (err) { toast.error(err.message); return; }
      setEmails((prev) => prev.map((x) => (idsToDelete.includes(x.id) ? { ...x, deleted_at: null } : x)));
      toast.success("Suppression annulée");
    };
    toast.success(
      idsToDelete.length > 1
        ? `${idsToDelete.length} emails déplacés vers la corbeille`
        : "Email déplacé vers la corbeille",
      {
        duration: 5000,
        action: { label: "Annuler", onClick: () => { void undoTrash(); } },
      },
    );
    pushUndo({ label: "Mise à la corbeille", run: undoTrash });
  };

  const restore = async (e: Email) => {
    setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, deleted_at: null } : x)));
    if (selectedId === e.id) setSelectedId(null);
    const { error } = await supabase
      .from("emails")
      .update({ deleted_at: null })
      .eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success("Email restauré");
  };

  const emptyTrash = async () => {
    const ids = emails.filter(isTrashed).map((x) => x.id);
    if (!ids.length) return;
    if (!confirm(`Vider la corbeille (${ids.length} email${ids.length > 1 ? "s" : ""}) ? Les messages seront aussi supprimés sur le serveur (Gmail/Outlook/IMAP).`))
      return;
    setEmails((prev) => prev.filter((x) => !ids.includes(x.id)));
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    // 1) Supprime localement → le trigger DB crée automatiquement les tombstones.
    const { error } = await supabase.from("emails").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success("Corbeille vidée");
    // 2) Purge côté serveur (best-effort, parallèle).
    toast.message("Suppression à la source…");
    const calls = await Promise.allSettled([
      supabase.functions.invoke("purge-gmail-source", { body: {} }),
      supabase.functions.invoke("purge-outlook-source", { body: {} }),
      supabase.functions.invoke("purge-imap-source", { body: {} }),
    ]);
    let purged = 0;
    for (const c of calls) {
      if (c.status === "fulfilled") {
        const d = (c.value as { data?: { purged?: number } }).data;
        purged += d?.purged ?? 0;
      }
    }
    toast.success(`${purged} message${purged > 1 ? "s" : ""} supprimé${purged > 1 ? "s" : ""} à la source`);
  };


  const emptySpam = async () => {
    const ids = emails.filter((x) => isSpam(x) && !isTrashed(x)).map((x) => x.id);
    if (!ids.length) return;
    if (!confirm(`Déplacer ${ids.length} indésirable${ids.length > 1 ? "s" : ""} vers la corbeille ?`))
      return;
    const now = new Date().toISOString();
    setEmails((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, deleted_at: now } : x)));
    const { error } = await supabase.from("emails").update({ deleted_at: now }).in("id", ids);
    if (error) toast.error(error.message);
    else toast.success("Indésirables vidés");
  };

  const markSpam = async (e: Email, asSpam: boolean) => {
    const update = asSpam
      ? { spam_label: "spam", spam_score: 100, spam_reason: "Marqué manuellement" }
      : { spam_label: "legit", spam_score: 0, spam_reason: "Non indésirable (utilisateur)" };
    setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, ...update } : x)));
    // Also persist in security_settings whitelist/blacklist
    const from = (e.from_address ?? "").toLowerCase();
    if (from) {
      const { data: sec } = await supabase
        .from("security_settings")
        .select("whitelist,blacklist")
        .eq("user_id", e.user_id)
        .maybeSingle();
      const wl = new Set((sec?.whitelist ?? []) as string[]);
      const bl = new Set((sec?.blacklist ?? []) as string[]);
      if (asSpam) {
        bl.add(from);
        wl.delete(from);
      } else {
        wl.add(from);
        bl.delete(from);
      }
      await supabase
        .from("security_settings")
        .upsert(
          { user_id: e.user_id, whitelist: [...wl], blacklist: [...bl] },
          { onConflict: "user_id" },
        );
    }
    const { error } = await supabase.from("emails").update(update).eq("id", e.id);
    if (error) toast.error(error.message);
    else toast.success(asSpam ? "Marqué comme indésirable" : "Marqué comme légitime");
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
    const ids = bulkIds();
    if (!ids.length) return;
    const snapshots = emails.filter((x) => checked.has(x.id));
    setEmails((prev) => prev.filter((x) => !checked.has(x.id)));
    if (selectedId && checked.has(selectedId)) setSelectedId(null);
    clearChecked();
    const { error } = await supabase.from("emails").update({ is_archived: true }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    const undoArchive = async () => {
      const { error: err } = await supabase.from("emails").update({ is_archived: false }).in("id", ids);
      if (err) { toast.error(err.message); return; }
      setEmails((prev) => {
        const known = new Set(prev.map((x) => x.id));
        const missing = snapshots.filter((s) => !known.has(s.id));
        return [...missing, ...prev];
      });
      toast.success("Archivage annulé");
    };
    toast.success(`${ids.length} email(s) archivé(s)`, {
      duration: 5000,
      action: { label: "Annuler", onClick: () => { void undoArchive(); } },
    });
    pushUndo({ label: "Archivage groupé", run: undoArchive });
  };
  const bulkDelete = async () => {
    const ids = bulkIds();
    if (!ids.length) return;
    const inTrash = filter === "trash";
    if (inTrash) {
      if (!confirm(`Supprimer définitivement ${ids.length} email(s) ?`)) return;
      setEmails((prev) => prev.filter((x) => !checked.has(x.id)));
      if (selectedId && checked.has(selectedId)) setSelectedId(null);
      clearChecked();
      const { error } = await supabase.from("emails").delete().in("id", ids);
      if (error) toast.error(error.message);
      else toast.success(`${ids.length} email(s) supprimé(s) définitivement`);
    } else {
      if (!confirm(`Déplacer ${ids.length} email(s) vers la corbeille ?`)) return;
      const now = new Date().toISOString();
      setEmails((prev) =>
        prev.map((x) => (checked.has(x.id) ? { ...x, deleted_at: now } : x)),
      );
      if (selectedId && checked.has(selectedId)) setSelectedId(null);
      clearChecked();
      const { error } = await supabase
        .from("emails")
        .update({ deleted_at: now })
        .in("id", ids);
      if (error) { toast.error(error.message); return; }
      const undoTrashBulk = async () => {
        const { error: err } = await supabase.from("emails").update({ deleted_at: null }).in("id", ids);
        if (err) { toast.error(err.message); return; }
        setEmails((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, deleted_at: null } : x)));
        toast.success("Suppression annulée");
      };
      toast.success(`${ids.length} email(s) dans la corbeille`, {
        duration: 5000,
        action: { label: "Annuler", onClick: () => { void undoTrashBulk(); } },
      });
      pushUndo({ label: "Mise à la corbeille (groupée)", run: undoTrashBulk });
    }
  };
  const bulkMarkRead = async (read: boolean) => {
    const ids = bulkIds();
    if (!ids.length) return;
    // Snapshot des valeurs avant pour l'annulation
    const prevByIdMap = new Map(emails.filter((x) => ids.includes(x.id)).map((x) => [x.id, x.is_read] as const));
    setEmails((prev) => prev.map((x) => (checked.has(x.id) ? { ...x, is_read: read } : x)));
    clearChecked();
    const { error } = await supabase.from("emails").update({ is_read: read }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    const undoFn = async () => {
      await Promise.all(
        Array.from(prevByIdMap.entries()).map(([id, val]) =>
          supabase.from("emails").update({ is_read: val }).eq("id", id),
        ),
      );
      setEmails((prev) => prev.map((x) => (prevByIdMap.has(x.id) ? { ...x, is_read: prevByIdMap.get(x.id)! } : x)));
      toast.success("Action annulée");
    };
    toast.success(`${ids.length} email(s) marqué(s) ${read ? "lus" : "non lus"}`, {
      duration: 5000,
      action: { label: "Annuler", onClick: () => { void undoFn(); } },
    });
  };

  // Déplacement groupé vers un thème IA (ou aucun)
  const bulkSetTheme = async (themeId: string | null) => {
    const ids = bulkIds();
    if (!ids.length) return;
    const prevByIdMap = new Map(
      emails.filter((x) => ids.includes(x.id)).map((x) => [x.id, x.ai_theme_id ?? null] as const),
    );
    setEmails((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, ai_theme_id: themeId } : x)));
    clearChecked();
    const { error } = await supabase.from("emails").update({ ai_theme_id: themeId }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    const themeName = themeId ? (themes.find((t) => t.id === themeId)?.name ?? "ce thème") : "Sans thème";
    const undoFn = async () => {
      await Promise.all(
        Array.from(prevByIdMap.entries()).map(([id, val]) =>
          supabase.from("emails").update({ ai_theme_id: val }).eq("id", id),
        ),
      );
      setEmails((prev) => prev.map((x) => (prevByIdMap.has(x.id) ? { ...x, ai_theme_id: prevByIdMap.get(x.id)! } : x)));
      toast.success("Déplacement annulé");
    };
    toast.success(`${ids.length} email(s) déplacé(s) vers « ${themeName} »`, {
      duration: 5000,
      action: { label: "Annuler", onClick: () => { void undoFn(); } },
    });
  };

  const openEmail = (e: Email) => {
    setSelectedId(e.id);
    setReaderOpen(true);
    if (!e.is_read) patch(e.id, { is_read: true });
    // Sur mobile/tablette : empile une entrée d'historique pour que le bouton
    // « Retour » du téléphone ferme l'email et revienne à la liste.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      try {
        window.history.pushState({ inboxReader: true }, "");
      } catch { /* ignore */ }
    }
  };

  // Bouton « Retour » du navigateur/téléphone → fermer le lecteur d'email
  // sur mobile au lieu de quitter la page Inbox.
  useEffect(() => {
    if (!readerOpen) return;
    const onPop = () => {
      setReaderOpen(false);
      setSelectedId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readerOpen]);


  return (
    <div className="-mx-3 -my-3 flex h-[calc(100vh-3.5rem)] min-w-0 max-w-[100vw] overflow-hidden sm:-mx-4 sm:-my-4 sm:h-[calc(100vh-4rem)] md:-mx-6">
      {/* LEFT — filters */}
      <aside
        style={isMobileInbox ? undefined : { width: leftW }}
        className={cn(
          "shrink-0 flex-col border-r bg-card",
          isMobileInbox
            ? mobileView === "sidebar"
              ? "flex w-full"
              : "hidden"
            : "hidden md:flex",
        )}
      >
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
          <Button
            size="sm"
            className="mb-3 w-full gap-1"
            onClick={() => openComposer({ mode: "new" })}
          >
            <Plus className="h-4 w-4" /> Nouveau message
          </Button>
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

        <nav
          className="flex-1 overflow-y-auto p-2 text-sm"
          onClick={(e) => {
            // Sur mobile, n'importe quel clic sur une boîte / un thème dans la
            // sidebar bascule vers la liste des mails (et empile l'historique
            // pour que le bouton retour ramène à cette sidebar). On ignore les
            // clics sur les boutons d'action (vider corbeille / spam, gérer
            // thèmes, relancer IA…) repérés par data-no-mobile-switch.
            if (!isMobileInbox) return;
            const target = e.target as HTMLElement;
            if (target.closest("[data-no-mobile-switch]")) return;
            if (!target.closest("button,summary,[role='button']")) return;
            if (mobileView === "list") return;
            setMobileView("list");
            try {
              window.history.pushState({ inboxList: true }, "");
            } catch {
              /* ignore */
            }
          }}
        >
          <FilterRow
            label="Tous les mails"
            icon={<Mail className="h-4 w-4" />}
            count={counts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterRow
            label="Non lus"
            icon={<Circle className="h-4 w-4 fill-current" />}
            count={counts.unread}
            active={filter === "unread"}
            onClick={() => setFilter("unread")}
          />
          <FilterRow
            label="Pièces jointes"
            icon={<Paperclip className="h-4 w-4" />}
            count={counts.attachments}
            active={filter === "attachments"}
            onClick={() => setFilter("attachments")}
          />
          <FilterRow
            label="Suivis"
            icon={<Star className="h-4 w-4" />}
            count={counts.starred}
            active={filter === "starred"}
            onClick={() => setFilter("starred")}
          />
          <FilterRow
            label="Promotions"
            icon={<Megaphone className="h-4 w-4" />}
            count={counts.promo}
            active={filter === "promo"}
            onClick={() => setFilter("promo")}
          />
          <FilterRow
            label="Indésirables"
            icon={<ShieldOff className="h-4 w-4" />}
            count={counts.spam}
            active={filter === "spam"}
            onClick={() => setFilter("spam")}
            onAction={counts.spam > 0 ? emptySpam : undefined}
            actionLabel="Vider les indésirables"
          />
          <FilterRow
            label="Corbeille"
            icon={<Trash2 className="h-4 w-4" />}
            count={counts.trash}
            active={filter === "trash"}
            onClick={() => setFilter("trash")}
            onAction={counts.trash > 0 ? emptyTrash : undefined}
            actionLabel="Vider la corbeille"
          />

          {/* Comptes first */}
          <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comptes
          </div>
          {accounts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Aucun compte configuré.</div>
          )}
          {accounts
            .filter((a) => !(a.credentials?.calendar_only === true) && !/calendar/i.test(a.name))
            .map((a) => (
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
                <span className="text-[11px] text-muted-foreground">
                  {counts.byAccount.get(a.id) ?? 0}
                </span>
              </button>
            ))}
          {!accounts.some((a) => a.name === "CHU" || a.type === "imap") && (
            <div data-no-mobile-switch>
              <QuickAddOvh onAdded={() => setReloadKey((k) => k + 1)} />
            </div>
          )}

          {/* Thèmes IA below Comptes, with relaunch + management */}
          <div className="mt-4 flex items-center justify-between px-3 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="mr-1 inline h-3 w-3" />
              Thèmes IA
            </span>
            <div className="flex items-center gap-0.5" data-no-mobile-switch>
              <button
                onClick={relaunchAi}
                disabled={relaunching}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="Relancer l'analyse IA"
              >
                {relaunching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={() => setThemesOpen(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Gérer les thèmes"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          {(() => {
            const renderThemesBlock = (scopeThemes: Theme[]) => {
              const { grouped, standalone } = groupThemes(scopeThemes, counts.byTheme);
              if (grouped.length === 0 && standalone.length === 0) return null;
              return (
                <>
                  {grouped.map((g) => (
                    <details key={g.name} open className="group/theme">
                      <summary className="flex w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform group-open/theme:rotate-90" />
                        <span className="flex-1 truncate text-xs font-medium">{g.name}</span>
                        <span className="text-[10px] text-muted-foreground">{g.total}</span>
                      </summary>
                      <div className="ml-3 border-l border-border/50 pl-1">
                        {g.items.map(({ theme: t, label }) => {
                          const n = counts.byTheme.get(t.id) ?? 0;
                          const active = filter === `theme:${t.id}`;
                          return (
                            <button
                              key={t.id}
                              onClick={() => setFilter(`theme:${t.id}`)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                                active ? "bg-accent" : "hover:bg-accent/50",
                              )}
                              title={t.description ?? t.name}
                            >
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px]">
                                {t.icon ?? "🏷️"}
                              </span>
                              <span className="flex-1 truncate text-xs">{label}</span>
                              <span className="text-[10px] text-muted-foreground">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                  {standalone
                    .map((t) => ({ t, n: counts.byTheme.get(t.id) ?? 0 }))
                    .sort((a, b) => b.n - a.n)
                    .map(({ t, n }) => {
                      const active = filter === `theme:${t.id}`;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setFilter(`theme:${t.id}`)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                            active ? "bg-accent" : "hover:bg-accent/50",
                          )}
                          title={t.description ?? t.name}
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-xs">
                            {t.icon ?? "🏷️"}
                          </span>
                          <span className="flex-1 truncate text-sm">{t.name}</span>
                          <span className="text-[11px] text-muted-foreground">{n}</span>
                        </button>
                      );
                    })}
                </>
              );
            };

            const proThemes = themes.filter((t) => t.scope === "pro");
            const persoThemes = themes.filter((t) => t.scope !== "pro");
            const proTotal = proThemes.reduce((s, t) => s + (counts.byTheme.get(t.id) ?? 0), 0);
            const persoTotal = persoThemes.reduce((s, t) => s + (counts.byTheme.get(t.id) ?? 0), 0);
            const proContent = renderThemesBlock(proThemes);
            const persoContent = renderThemesBlock(persoThemes);

            if (!proContent && !persoContent) {
              return (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Analyse en cours… ou cliquez sur ↻ pour lancer.
                </div>
              );
            }
            return (
              <>
                <details open className="group/scope mt-1">
                  <summary className="flex w-full cursor-pointer list-none items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1 text-left hover:bg-blue-500/15 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-3 w-3 text-blue-700 transition-transform group-open/scope:rotate-90 dark:text-blue-300" />
                    <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">💼 Pro</span>
                    <span className="text-[10px] font-medium text-blue-700/70 dark:text-blue-300/70">{proTotal}</span>
                  </summary>
                  <div className="mt-1">
                    {proContent ?? (
                      <div className="px-3 py-1.5 text-[11px] italic text-muted-foreground">Aucun thème pro</div>
                    )}
                  </div>
                </details>
                <details open className="group/scope mt-2">
                  <summary className="flex w-full cursor-pointer list-none items-center gap-1.5 rounded-md bg-pink-500/10 px-2 py-1 text-left hover:bg-pink-500/15 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-3 w-3 text-pink-700 transition-transform group-open/scope:rotate-90 dark:text-pink-300" />
                    <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-pink-700 dark:text-pink-300">❤️ Personnel</span>
                    <span className="text-[10px] font-medium text-pink-700/70 dark:text-pink-300/70">{persoTotal}</span>
                  </summary>
                  <div className="mt-1">
                    {persoContent ?? (
                      <div className="px-3 py-1.5 text-[11px] italic text-muted-foreground">Aucun thème perso</div>
                    )}
                  </div>
                </details>
              </>
            );
          })()}
          {counts.noTheme > 0 && (
            <button
              onClick={() => setFilter("theme:__none__")}
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                filter === "theme:__none__" ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-xs">
                ❓
              </span>
              <span className="flex-1 truncate text-sm italic text-muted-foreground">
                Non classés
              </span>
              <span className="text-[11px] text-muted-foreground">{counts.noTheme}</span>
            </button>
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
      <section
        className={cn(
          "min-w-0 max-w-full flex-1 flex-col border-r overflow-hidden",
          isMobileInbox && mobileView === "sidebar" ? "hidden" : "flex",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                // Sur mobile : revenir à la sidebar (boîtes + thèmes IA).
                // Si une entrée d'historique a été empilée pour la liste, on
                // la dépile pour rester cohérent avec le bouton retour natif.
                if (typeof window !== "undefined" && window.history.state?.inboxList) {
                  window.history.back();
                } else {
                  setMobileView("sidebar");
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              title="Retour aux boîtes mail"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Button
              size="sm"
              variant={filter === "all" && !aiRanking ? "secondary" : "ghost"}
              className="h-7 shrink-0 gap-1 px-2 text-xs font-medium"
              onClick={() => {
                setFilter("all");
                setAiRanking(false);
                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                  setSelectedId(null);
                }
              }}
              title="Afficher tous les mails sans classement IA"
            >
              <Mail className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tous les mails</span>
            </Button>
            <Select
              value={
                filter.startsWith("account:") ||
                filter === "unread" ||
                filter === "starred" ||
                filter === "attachments" ||
                filter === "spam" ||
                filter === "trash"
                  ? filter
                  : "all"
              }
              onValueChange={(v) => {
                setFilter(v as Filter);
                // Quand on choisit "Tous les comptes" ou un compte spécifique,
                // on désactive le classement IA pour revenir à une liste
                // chronologique plate (évite que la vue groupée par thème
                // reste affichée, notamment sur mobile).
                if (v === "all" || v.startsWith("account:")) setAiRanking(false);
                // Sur mobile, fermer le lecteur plein écran pour afficher la liste
                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                  setSelectedId(null);
                }
              }}
            >
              <SelectTrigger className="h-7 w-auto max-w-[150px] gap-1 border-0 bg-transparent px-1 text-xs font-medium text-foreground hover:bg-accent/50 focus:ring-0 sm:max-w-none [&>svg]:hidden">
                <SelectValue placeholder="Filtres" />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="unread" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Circle className="h-3.5 w-3.5 fill-current text-muted-foreground" />
                    Non lus
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {counts.unread}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="starred" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 text-amber-400" />
                    Suivis
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {counts.starred}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="attachments" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    Pièces jointes
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {counts.attachments}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="spam" className="text-xs">
                  <div className="flex items-center gap-2">
                    <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
                    Indésirables
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {counts.spam}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="trash" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Corbeille
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {counts.trash}
                    </span>
                  </div>
                </SelectItem>
                {accounts
                  .filter(
                    (a) => !(a.credentials?.calendar_only === true) && !/calendar/i.test(a.name),
                  )
                  .map((a) => (
                    <SelectItem key={a.id} value={`account:${a.id}`} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: a.color ?? "#64748b" }}
                        />
                        {a.name}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {counts.byAccount.get(a.id) ?? 0}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={aiRanking ? "default" : "ghost"}
              className="h-7 shrink-0 gap-1 px-2 text-xs font-medium"
              onClick={() => setAiRanking((v) => !v)}
              title="Trier la liste par thème IA (mails les plus récents en tête)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Classement IA</span>
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {undoStack.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={runUndo}
                title={`Annuler : ${undoStack[undoStack.length - 1].label}`}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Annuler
              </Button>
            )}
            {(filter === "trash" || filter === "spam") && filtered.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={filter === "trash" ? emptyTrash : emptySpam}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vider
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {filtered.length} email{filtered.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-xs",
            checked.size > 0 ? "bg-primary/5" : "bg-muted/30",
          )}
        >
          <input
            type="checkbox"
            checked={filtered.length > 0 && filtered.every((e) => checked.has(e.id))}
            ref={(el) => {
              if (el)
                el.indeterminate =
                  checked.size > 0 &&
                  !(filtered.length > 0 && filtered.every((e) => checked.has(e.id)));
            }}
            onChange={(ev) => {
              if (ev.target.checked) setChecked(new Set(filtered.map((e) => e.id)));
              else clearChecked();
            }}
            className="h-3.5 w-3.5 cursor-pointer"
            title="Tout sélectionner"
            disabled={filtered.length === 0}
          />
          {aiRanking && (() => {
            const headerKeys = displayItems
              .filter((it) => it.kind === "header")
              .map((it) => (it as { key: string }).key);
            const allCollapsed =
              headerKeys.length > 0 && headerKeys.every((k) => collapsedThemes.has(k));
            return (
              <button
                type="button"
                onClick={() => {
                  if (allCollapsed) setCollapsedThemes(new Set());
                  else setCollapsedThemes(new Set(headerKeys));
                }}
                disabled={headerKeys.length === 0}
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                title={allCollapsed ? "Tout déplier" : "Tout replier"}
              >
                {allCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {allCollapsed ? "Déplier" : "Replier"}
                </span>
              </button>
            );
          })()}
          {checked.size > 0 ? (
            <>
              <span className="font-medium">
                {checked.size} mail{checked.size > 1 ? "s" : ""} sélectionné{checked.size > 1 ? "s" : ""}
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2"
                  onClick={() => bulkMarkRead(true)}
                >
                  <MailOpen className="h-3.5 w-3.5" /> Marquer lu
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2"
                  onClick={() => bulkMarkRead(false)}
                >
                  <Mail className="h-3.5 w-3.5" /> Marquer non lu
                </Button>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={bulkArchive}>
                  <Archive className="h-3.5 w-3.5" /> Archiver
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-destructive hover:text-destructive"
                  onClick={bulkDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-6 gap-1 px-2">
                      <FolderInput className="h-3.5 w-3.5" /> Déplacer
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                    <DropdownMenuLabel>Déplacer vers un thème</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => bulkSetTheme(null)}>
                      Sans thème
                    </DropdownMenuItem>
                    {themes.length > 0 && <DropdownMenuSeparator />}
                    {themes.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => bulkSetTheme(t.id)}>
                        {t.icon ? <span className="mr-2">{t.icon}</span> : null}
                        <span className="truncate">{t.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={clearChecked}>
                  ✕ Annuler la sélection
                </Button>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">Sélectionner pour actions groupées</span>
          )}
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {filtered.length === 0 && (
            <li className="p-6 text-center text-sm text-muted-foreground sm:p-10">
              {emails.length === 0
                ? "Aucun email — configurez un compte dans Paramètres."
                : "Aucun résultat."}
            </li>
          )}
          {displayItems.map((item) => {
            if (item.kind === "header") {
              return (
                <li
                  key={`h:${item.key}`}
                  onClick={() => toggleTheme(item.key)}
                  className="sticky top-0 z-10 flex min-w-0 cursor-pointer items-center gap-2 border-b bg-primary/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary backdrop-blur hover:bg-primary/20"
                >
                  {collapsedThemes.has(item.key) ? (
                    <ChevronRight className="h-3 w-3 text-primary" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-primary" />
                  )}
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto text-[10px] font-normal">{item.count}</span>
                </li>
              );
            }
            const e = item.email;
            const acc = accountById.get(e.account_id);
            const isSel = e.id === selectedId;
            const rowInner = (
              <div
                onClick={() => openEmail(e)}
                className={cn(
                  "group relative min-w-0 cursor-pointer border-l-2 px-3 py-2.5 transition-colors",
                  isSel ? "bg-accent" : "hover:bg-accent/50",
                  !e.is_read ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent",
                )}
              >
                <div className="flex min-w-0 items-start gap-2.5">
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
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          priorityDotClass(e.ai_priority),
                        )}
                        title={
                          e.ai_priority ? `Priorité IA : ${e.ai_priority}` : "Priorité non analysée"
                        }
                      />
                      {!e.is_read && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title="Non lu" />
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          !e.is_read ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {e.from_name || e.from_address || "Inconnu"}
                      </span>
                      <div className="ml-auto shrink-0 text-right text-[11px] text-muted-foreground leading-tight">
                        <div>{relativeTime(e.received_at)}</div>
                        {e.received_at && (
                          <div className="hidden text-[10px] opacity-75 sm:block">
                            {new Date(e.received_at).toLocaleDateString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                            })}{" "}
                            ·{" "}
                            {new Date(e.received_at).toLocaleTimeString("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "break-words text-sm",
                        !e.is_read ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
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
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
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
                      {e.meeting_link && (
                        <span
                          className="flex items-center gap-0.5 rounded bg-blue-500/15 px-1 text-[10px] text-blue-600 dark:text-blue-400"
                          title={`Lien de réunion détecté: ${e.meeting_link}`}
                        >
                          🎥 Visio
                        </span>
                      )}
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
                  <IconBtn
                    label={e.is_read ? "Marquer non lu" : "Marquer lu"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleRead(e);
                    }}
                  >
                    {e.is_read ? (
                      <Mail className="h-3.5 w-3.5" />
                    ) : (
                      <MailOpen className="h-3.5 w-3.5" />
                    )}
                  </IconBtn>
                  {e.deleted_at && (
                    <IconBtn
                      label="Restaurer"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        restore(e);
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
                    </IconBtn>
                  )}
                  <IconBtn
                    label={e.deleted_at ? "Supprimer définitivement" : "Supprimer"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      remove(e);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </IconBtn>
                  <IconBtn
                    label="Étoiler"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleStar(e);
                    }}
                  >
                    <Star
                      className={cn("h-3.5 w-3.5", e.is_starred && "fill-amber-400 text-amber-400")}
                    />
                  </IconBtn>
                  <IconBtn
                    label="Archiver"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      archive(e);
                    }}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Créer une tâche"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedId(e.id);
                      setTaskOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Reporter en tâche à traiter"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      postponeAsTask(e);
                    }}
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </div>
            );
            const leftActions: SwipeAction[] = [
              {
                key: "reply",
                label: "Répondre",
                icon: <Reply className="h-4 w-4" />,
                color: "bg-blue-500",
                onAction: () => openComposer(buildReplyInit(e, false)),
              },
              {
                key: "forward",
                label: "Transférer",
                icon: <Forward className="h-4 w-4" />,
                color: "bg-indigo-500",
                onAction: () => openComposer(buildForwardInit(e)),
              },
            ];
            const rightActions: SwipeAction[] = [
              {
                key: "spam",
                label: "Indésirable",
                icon: <ShieldAlert className="h-4 w-4" />,
                color: "bg-amber-500",
                onAction: () => markSpam(e, true),
              },
              {
                key: "delete",
                label: "Supprimer",
                icon: <Trash2 className="h-4 w-4" />,
                color: "bg-red-500",
                onAction: () => remove(e),
              },
            ];
            return (
              <li key={e.id} className="list-none">
                {isMobileInbox ? (
                  <SwipeableRow leftActions={leftActions} rightActions={rightActions}>
                    {rowInner}
                  </SwipeableRow>
                ) : (
                  rowInner
                )}
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
          width: winW >= 1024 ? Math.min(rightW, Math.max(360, winW - leftW - 380)) : undefined,
        }}
        className={cn(
          "min-w-0 shrink-0 flex-col bg-card lg:flex lg:relative lg:inset-auto lg:z-auto",
          selected && (!isMobileInbox || readerOpen) ? "fixed inset-0 z-40 flex" : "hidden lg:flex",
        )}
      >
        {selected && (
          <button
            onClick={() => {
              // Si une entrée d'historique a été empilée pour le lecteur,
              // on la dépile pour rester cohérent avec le bouton retour natif.
              if (typeof window !== "undefined" && window.history.state?.inboxReader) {
                window.history.back();
              } else {
                setReaderOpen(false);
                setSelectedId(null);
              }
            }}
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
            onRestore={selected.deleted_at ? () => restore(selected) : undefined}
            onCreateTask={() => setTaskOpen(true)}
            onPostpone={() => postponeAsTask(selected)}
            onCompose={openComposer}
            onMarkSpam={(asSpam) => markSpam(selected, asSpam)}
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

      <ThemesManagerDialog
        open={themesOpen}
        onOpenChange={setThemesOpen}
        onChanged={() => {
          refreshThemes();
          setReloadKey((k) => k + 1);
        }}
      />

      <EmailComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        accounts={accounts}
        initial={composerInitial}
      />
    </div>
  );
}

function FilterRow({
  label,
  icon,
  count,
  active,
  onClick,
  onAction,
  actionLabel,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
      )}
    >
      <button onClick={onClick} className="flex flex-1 items-center gap-2 min-w-0">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1 truncate text-sm">{label}</span>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </button>
      {onAction && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          title={actionLabel}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
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
  onRestore,
  onCreateTask,
  onPostpone,
  onCompose,
  onMarkSpam,
}: {
  email: Email;
  account?: Account;
  userId: string;
  onStar: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onCreateTask: () => void;
  onPostpone: () => void;
  onCompose: (init: ComposerInitial) => void;
  onMarkSpam: (asSpam: boolean) => void;
}) {
  const [sensitiveOverride, setSensitiveOverride] = useState<boolean | null>(null);
  const isSensitive = sensitiveOverride ?? email.is_sensitive;
  useEffect(() => {
    setSensitiveOverride(null);
  }, [email.id]);
  const unmarkSensitive = async () => {
    if (
      !window.confirm(
        "Confirmer que ce message ne contient pas de données sensibles ? L'analyse IA sera réactivée.",
      )
    )
      return;
    const { error } = await supabase
      .from("emails")
      .update({ is_sensitive: false, sensitive_reason: null, sensitive_score: null })
      .eq("id", email.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSensitiveOverride(false);
    toast.success("Caractère sensible levé");
  };
  const isSpamEmail = email.spam_label === "spam" || email.spam_label === "phishing";
  const isPostponed = (email.labels ?? []).includes("task-todo");
  const quoted = () => {
    const dateStr = email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : "";
    const sender = email.from_name
      ? `${email.from_name} <${email.from_address}>`
      : (email.from_address ?? "");
    const body = (email.body_text ?? "")
      .split("\n")
      .map((l) => "> " + l)
      .join("\n");
    return `\n\n\nLe ${dateStr}, ${sender} a écrit :\n${body}`;
  };
  const replyRefs = email.message_id ? `<${email.message_id}>` : undefined;
  const subjReply = email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject ?? ""}`;
  const subjFwd = email.subject?.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject ?? ""}`;
  const doReply = (all: boolean) =>
    onCompose({
      mode: all ? "replyAll" : "reply",
      defaultAccountId: email.account_id,
      to: email.from_address ?? "",
      cc: all ? (email.to_address ?? "") : undefined,
      subject: subjReply,
      body: quoted(),
      inReplyTo: replyRefs,
      references: replyRefs,
    });
  const doForward = () =>
    onCompose({
      mode: "forward",
      defaultAccountId: email.account_id,
      subject: subjFwd,
      body: `\n\n---------- Message transféré ----------\nDe: ${email.from_name ?? ""} <${email.from_address ?? ""}>\nDate: ${email.received_at ?? ""}\nSujet: ${email.subject ?? ""}\nÀ: ${email.to_address ?? ""}\n\n${email.body_text ?? ""}`,
    });
  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden overflow-y-auto">
      <header className="min-w-0 border-b p-3 sm:p-4">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          {account && (
            <Badge
              style={{ background: account.color ?? "#64748b", color: "#fff" }}
              className="border-0"
            >
              {account.icon} {account.name}
            </Badge>
          )}
          <button onClick={onStar} className="ml-auto text-muted-foreground hover:text-amber-400">
            <Star className={cn("h-4 w-4", email.is_starred && "fill-amber-400 text-amber-400")} />
          </button>
        </div>
        <h2 className="break-words text-base font-semibold">{email.subject || "(sans objet)"}</h2>
        <div className="mt-2 space-y-0.5 break-words text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">De :</span>{" "}
            <span className="break-all">
              {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}
            </span>
          </div>
          <div>
            <span className="font-medium text-foreground">À :</span>{" "}
            <span className="break-all">{email.to_address}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Date :</span>{" "}
            {email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : ""}
          </div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => doReply(false)}>
            <Reply className="h-3 w-3" /> Répondre
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => doReply(true)}>
            <ReplyAll className="h-3 w-3" /> Tous
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={doForward}>
            <Forward className="h-3 w-3" /> Transférer
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onArchive}>
            <Archive className="h-3 w-3" /> Archiver
          </Button>
          {onRestore && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1"
              onClick={onRestore}
            >
              <RefreshCw className="h-3 w-3" /> Restaurer
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" /> {email.deleted_at ? "Suppr. définitive" : "Suppr."}
          </Button>
          <Button size="sm" className="h-7 gap-1" onClick={onCreateTask}>
            <Plus className="h-3 w-3" /> Créer tâche
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={onPostpone}
            disabled={isPostponed}
          >
            <Clock className="h-3 w-3" />
            {isPostponed ? "Déjà reportée" : "Reporter"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => onMarkSpam(!isSpamEmail)}
            title={
              isSpamEmail
                ? "Marquer comme légitime (whitelist)"
                : "Marquer comme indésirable (blacklist)"
            }
          >
            {isSpamEmail ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
            {isSpamEmail ? "Pas indésirable" : "Indésirable"}
          </Button>
        </div>
        {(email.spam_label === "spam" ||
          email.spam_label === "phishing" ||
          email.spam_label === "promo") && (
          <div
            className={cn(
              "mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px]",
              email.spam_label === "phishing" &&
                "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
              email.spam_label === "spam" &&
                "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
              email.spam_label === "promo" &&
                "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
            )}
          >
            {email.spam_label === "phishing" ? (
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
            ) : email.spam_label === "spam" ? (
              <ShieldOff className="mt-0.5 h-3 w-3 shrink-0" />
            ) : (
              <Megaphone className="mt-0.5 h-3 w-3 shrink-0" />
            )}
            <span>
              <span className="font-semibold capitalize">{email.spam_label}</span>
              {typeof email.spam_score === "number" && ` · score ${email.spam_score}`}
              {email.spam_reason && ` — ${email.spam_reason}`}
            </span>
          </div>
        )}
      </header>

      {isSensitive ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Email marqué sensible (HDS)</div>
              <div className="mt-0.5 opacity-90">
                Données de santé potentielles détectées :{" "}
                {email.sensitive_reason ?? "motif inconnu"}. Aucune analyse IA n'est effectuée sur
                ce message.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 border-red-500/40 text-xs"
              onClick={unmarkSensitive}
              title="Lever le caractère sensible après vérification"
            >
              Lever
            </Button>
          </div>
          <VaultActions email={email} onMoved={onArchive} />
        </div>
      ) : (
        <AiClassificationFeedback
          emailId={email.id}
          priority={email.ai_priority}
          category={email.ai_category}
          onUpdated={() => {
            /* cache will refresh on next sync */
          }}
        />
      )}

      {email.has_attachment && (
        <EmailAttachmentsPanel
          emailId={email.id}
          fromAddress={email.from_address}
          subject={email.subject}
        />
      )}

      <div className="min-w-0 max-w-full p-3 text-sm sm:p-4">
        {email.body_html ? (
          <div
            className="prose prose-sm max-w-none break-words dark:prose-invert [&_*]:max-w-full [&_img]:h-auto [&_img]:max-w-full [&_table]:w-full [&_table]:table-fixed"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">
            {email.body_text ?? "(vide)"}
          </pre>
        )}
      </div>

      {!isSensitive && (
        <AiSuggestionsPanel
          emailId={email.id}
          fromAddress={email.from_address}
          subject={email.subject}
          userId={userId}
          onCreateTask={() => onCreateTask()}
          onArchive={onArchive}
          onUseReply={(text) =>
            onCompose({
              mode: "reply",
              defaultAccountId: email.account_id,
              to: email.from_address ?? "",
              subject: subjReply,
              body: text + quoted(),
              inReplyTo: replyRefs,
              references: replyRefs,
            })
          }
        />
      )}

    </div>
  );
}

function priorityDotClass(p: string | null | undefined): string {
  switch (p) {
    case "urgent":
      return "bg-red-500";
    case "important":
      return "bg-orange-500";
    case "normal":
      return "bg-yellow-400";
    case "low":
      return "bg-green-500";
    default:
      return "bg-muted-foreground/30";
  }
}

function categoryLabel(c: string | null | undefined): string {
  switch (c) {
    case "action":
      return "📋 Action";
    case "rendez-vous":
      return "📅 RDV";
    case "document":
      return "📄 Doc";
    case "facturation":
      return "💰 Facture";
    case "rh":
      return "👥 RH";
    case "info":
      return "📣 Info";
    case "newsletter":
      return "🗑️ Newsletter";
    default:
      return c ?? "";
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
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          onClick={moveToVault}
          disabled={busy}
        >
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
