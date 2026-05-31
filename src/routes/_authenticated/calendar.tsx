import React, { useEffect, useMemo, useState } from "react";
import { requestAutoSync } from "@/lib/sync-queue";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Video,
  Users,
  X,
  Trash2,
  CheckSquare,
  Link2,
  Share2,
  Paperclip,
  Download,
  Mail,
} from "lucide-react";
import { AttachmentViewerDialog } from "@/components/inbox/attachment-viewer-dialog";
import { getSignedUrl, type DocumentRow } from "@/lib/documents";
import { formatBytes } from "@/lib/file-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useServerFn } from "@tanstack/react-start";
import { startGoogleCalendarOAuth, syncGoogleCalendarEvents } from "@/lib/api/google-calendar.functions";
import { supabase } from "@/integrations/supabase/client";
import { cacheGetAll, cacheReplaceAll } from "@/lib/local-cache";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar as MiniCal } from "@/components/ui/calendar";
import { useCalendarHours } from "@/lib/calendar-prefs";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: AgendaPage,
});

type View = "day" | "week" | "month" | "list";

type AccountType = "gmail" | "outlook" | "imap" | "icloud";
type Account = {
  id: string;
  name: string;
  type: AccountType;
  color: string | null;
  sync_direction: "push" | "pull" | "bidirectional" | "disabled";
};

type DbEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  color: string | null;
  account_id: string | null;
  source: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  description: string | null;
};

type UnifiedEvent = {
  id: string;
  kind: "event" | "task";
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  description: string | null;
  color: string;
  badge: string; // emoji
  sourceLabel: string;
  accountId: string | null;
  isAllDay: boolean;
  hasVideo: boolean;
  raw: DbEvent | TaskRow;
};

const VIDEO_RX = /(meet\.google\.com|zoom\.us|teams\.microsoft|teams\.live)/i;

const SOURCE_META: Record<
  AccountType | "task",
  { badge: string; color: string; label: string }
> = {
  gmail: { badge: "🔵", color: "#3b82f6", label: "Google" },
  icloud: { badge: "⚫", color: "#374151", label: "iCloud" },
  outlook: { badge: "🔷", color: "#0ea5e9", label: "Outlook" },
  imap: { badge: "✉️", color: "#64748b", label: "IMAP" },
  task: { badge: "🟠", color: "#f97316", label: "Tâche MyHub" },
};

// ------- Date helpers -------
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; return addDays(x, -day); }; // Monday
const startOfMonth = (d: Date) => { const x = startOfDay(d); x.setDate(1); return x; };
const endOfMonth = (d: Date) => { const x = startOfMonth(d); x.setMonth(x.getMonth() + 1); return addDays(x, -1); };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtTime = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
const fmtMonth = (d: Date) =>
  d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

// Long press detector (works for mouse and touch). Fires `cb` after 500ms hold without significant movement.
function useLongPress(cb: () => void, ms = 500) {
  const state = React.useRef<{ t: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ t: null, x: 0, y: 0, fired: false });
  const clear = () => { if (state.current.t) { clearTimeout(state.current.t); state.current.t = null; } };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      state.current.x = e.clientX; state.current.y = e.clientY; state.current.fired = false;
      clear();
      state.current.t = setTimeout(() => { state.current.fired = true; cb(); }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!state.current.t) return;
      if (Math.abs(e.clientX - state.current.x) > 8 || Math.abs(e.clientY - state.current.y) > 8) clear();
    },
    onPointerUp: () => clear(),
    onPointerLeave: () => clear(),
    onPointerCancel: () => clear(),
  };
}



function AgendaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>(isMobile ? "list" : "week");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<DbEvent[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selected, setSelected] = useState<UnifiedEvent | null>(null);
  const [creatingAt, setCreatingAt] = useState<Date | null>(null);
  const openCreate = (d?: Date) => {
    const base = d ? new Date(d) : (() => { const x = new Date(cursor); x.setHours(9, 0, 0, 0); return x; })();
    setCreatingAt(base);
  };
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const startGcalOAuth = useServerFn(startGoogleCalendarOAuth);
  const syncGcal = useServerFn(syncGoogleCalendarEvents);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("gcal_error");
    if (err) {
      setOauthError(decodeURIComponent(err));
      // Clean URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete("gcal_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const connectGoogleCalendar = async () => {
    setConnectingGoogle(true);
    setOauthError(null);
    try {
      const { authorizationUrl } = await startGcalOAuth({ data: { label: "Google Calendar" } });
      window.location.assign(authorizationUrl);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Connexion Google Calendar impossible";
      toast.error(msg);
      setOauthError(msg);
      setConnectingGoogle(false);
    }
  };

  const load = async () => {
    // Cache-first hydration
    const [cAccs, cEvs, cTks] = await Promise.all([
      cacheGetAll<Account>("accounts"),
      cacheGetAll<DbEvent>("calendar_events"),
      cacheGetAll<TaskRow>("tasks"),
    ]);
    if (cAccs.length) setAccounts(cAccs);
    if (cEvs.length) setEvents(cEvs);
    if (cTks.length) setTasks(cTks as TaskRow[]);
    if (!navigator.onLine) return;
    const [{ data: accs }, { data: evs }, { data: tks }] = await Promise.all([
      supabase.from("accounts").select("id,name,type,color,sync_direction").order("created_at"),
      supabase.from("calendar_events").select("*").order("start_at"),
      supabase.from("tasks").select("id,title,due_date,description").not("due_date", "is", null),
    ]);
    if (accs) { setAccounts(accs as Account[]); cacheReplaceAll("accounts", accs as Account[]).catch(() => {}); }
    if (evs) { setEvents(evs as DbEvent[]); cacheReplaceAll("calendar_events", evs as DbEvent[]).catch(() => {}); }
    if (tks) { setTasks(tks as TaskRow[]); /* don't overwrite full tasks cache from partial select */ }
  };

  const runSync = async (silent = false) => {
    setSyncingGoogle(true);
    try {
      const res = await syncGcal({ data: {} });
      if (!silent) {
        if (res.connections === 0) toast.info("Aucun compte Google Calendar connecté.");
        else toast.success(`${res.synced} événement(s) synchronisé(s).`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[gcal sync]", e);
      if (!silent) toast.error(`Sync Google Calendar : ${msg}`);
    } finally {
      setSyncingGoogle(false);
    }
  };

  useEffect(() => { if (user) { load().then(() => runSync(true)); } }, [user]);
  useEffect(() => {
    const onOnline = () => { if (user) load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const accById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const unified: UnifiedEvent[] = useMemo(() => {
    const items: UnifiedEvent[] = [];
    for (const e of events) {
      const acc = e.account_id ? accById.get(e.account_id) : null;
      const isGoogle = e.source === "google" || (e as any).gcal_connection_id != null;
      const meta = isGoogle ? SOURCE_META.gmail : (acc ? SOURCE_META[acc.type] : SOURCE_META.imap);
      const blob = `${e.description ?? ""} ${e.location ?? ""}`;
      items.push({
        id: `e:${e.id}`,
        kind: "event",
        title: e.title,
        start: new Date(e.start_at),
        end: new Date(e.end_at),
        location: e.location,
        description: e.description,
        color: e.color || acc?.color || meta.color,
        badge: meta.badge,
        sourceLabel: acc?.name ?? meta.label,
        accountId: e.account_id,
        isAllDay: e.is_all_day,
        hasVideo: VIDEO_RX.test(blob),
        raw: e,
      });
    }
    // Les tâches ne sont volontairement pas affichées dans l'agenda
    return items.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, tasks, accById]);

  // Range for current view
  const range = useMemo(() => {
    if (view === "day") return { from: startOfDay(cursor), to: endOfDay(cursor) };
    if (view === "week") {
      const f = startOfWeek(cursor);
      return { from: f, to: endOfDay(addDays(f, 6)) };
    }
    if (view === "month") return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
    return { from: startOfDay(cursor), to: endOfDay(addDays(cursor, 30)) };
  }, [view, cursor]);

  const inRange = useMemo(
    () => unified.filter((e) => e.end >= range.from && e.start <= range.to),
    [unified, range],
  );

  const nav = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setCursor(startOfDay(new Date()));
    const step = view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 30 : 7;
    setCursor((c) => addDays(c, dir * step));
  };

  const periodLabel = () => {
    if (view === "day") return cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (view === "week") {
      const f = startOfWeek(cursor);
      const t = addDays(f, 6);
      return `${f.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} – ${t.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    if (view === "month") return fmtMonth(cursor);
    return "Prochains événements";
  };

  const deleteEvent = async (ev: UnifiedEvent) => {
    if (ev.kind !== "event") return;
    if (!confirm(`Supprimer "${ev.title}" ?`)) return;
    const id = (ev.raw as DbEvent).id;
    // Optimistic update + cache: avoid the cache rehydrate flash that reintroduced the event.
    const prev = events;
    const next = prev.filter((e) => e.id !== id);
    setEvents(next);
    setSelected(null);
    cacheReplaceAll("calendar_events", next).catch(() => {});
    const { error } = await supabase.from("calendar_events").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      setEvents(prev);
      cacheReplaceAll("calendar_events", prev).catch(() => {});
    } else {
      toast.success("Événement supprimé");
    }
  };

  const moveEvent = async (ev: UnifiedEvent, deltaMin: number) => {
    if (ev.kind !== "event" || deltaMin === 0) return;
    const newStart = new Date(ev.start.getTime() + deltaMin * 60000);
    const newEnd = new Date(ev.end.getTime() + deltaMin * 60000);
    const { error } = await supabase
      .from("calendar_events")
      .update({ start_at: newStart.toISOString(), end_at: newEnd.toISOString() })
      .eq("id", (ev.raw as DbEvent).id);
    if (error) toast.error(error.message);
    else { toast.success("Événement déplacé"); load(); }
  };

  const shareEvent = (ev: UnifiedEvent) => {
    const subject = encodeURIComponent(`Invitation : ${ev.title}`);
    const lines = [
      `Bonjour,`,
      ``,
      `Je vous propose le rendez-vous suivant :`,
      `• ${ev.title}`,
      `• Quand : ${fmtDate(ev.start)} de ${fmtTime(ev.start)} à ${fmtTime(ev.end)}`,
      ev.location ? `• Lieu : ${ev.location}` : null,
      ev.hasVideo && ev.description ? `• Visio : voir lien dans la description` : null,
      ``,
      ev.description ?? "",
      ``,
      `Cordialement,`,
    ].filter(Boolean).join("\n");
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(lines)}`;
  };


  const createTaskFromEvent = (ev: UnifiedEvent) => {
    const dateStr = ev.start.toISOString().slice(0, 10);
    navigate({
      to: "/tasks",
      search: {
        newTitle: `Préparer : ${ev.title}`,
        newDescription: `Lié à l'événement du ${fmtDate(ev.start)} à ${fmtTime(ev.start)}${ev.location ? ` — ${ev.location}` : ""}`,
        newDue: dateStr,
        newStart: dateStr,
        newCalendarEventId: ev.kind === "event" ? (ev.raw as DbEvent).id : undefined,
      },
    });
  };

  return (
    <div className="-mx-3 -my-3 flex h-[calc(100vh-3.5rem)] overflow-hidden sm:-mx-4 sm:-my-4 sm:h-[calc(100vh-4rem)] md:-mx-6">
      {/* LEFT SIDEBAR — mini calendar + filters */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-semibold">Agenda unifié</h1>
          </div>
          <Button className="w-full gap-1.5" onClick={() => openCreate()}>
            <Plus className="h-4 w-4" /> Nouvel événement
          </Button>
        </div>

        <div className="border-b p-2">
          <MiniCal
            mode="single"
            selected={cursor}
            onSelect={(d) => d && setCursor(startOfDay(d))}
            modifiers={{
              hasEvent: unified.map((e) => e.start),
            }}
            modifiersClassNames={{
              hasEvent: "relative after:absolute after:bottom-0.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
            }}
            className="pointer-events-auto p-2"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sources
          </div>
          <Legend color={SOURCE_META.gmail.color} badge="🔵" label="Google Calendar" />
          <Legend color={SOURCE_META.icloud.color} badge="⚫" label="iCloud" />
          <Legend color={SOURCE_META.outlook.color} badge="🔷" label="Outlook / Exchange" />
          <Legend color={SOURCE_META.task.color} badge="🟠" label="Tâches MyHub Pro" />

          <div className="mt-4 space-y-2">
            {accounts.some((a) => a.type === "gmail") ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                disabled
              >
                <Link2 className="h-3.5 w-3.5" />
                Google Calendar connecté
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={connectGoogleCalendar}
                disabled={connectingGoogle}
              >
                <Link2 className="h-3.5 w-3.5" />
                {connectingGoogle ? "Redirection…" : "Connecter Google Calendar"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1.5"
              onClick={() => runSync(false)}
              disabled={syncingGoogle}
            >
              {syncingGoogle ? "Synchronisation…" : "Synchroniser maintenant"}
            </Button>
          </div>

          {oauthError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <p className="mb-1 font-semibold">&#9888; Connexion Google Calendar &eacute;chou&eacute;e</p>
              <p className="opacity-90">{oauthError}</p>
              <p className="mt-2 text-[11px] opacity-75">
                V&eacute;rifiez que votre email est ajout&eacute; en tant qu'utilisateur de test dans Google Cloud Console, que l'API Calendar est activ&eacute;e, et que les URI de redirection sont correctes.
              </p>
              <button
                onClick={() => setOauthError(null)}
                className="mt-2 text-[11px] text-red-300 underline hover:text-red-200"
              >
                Masquer
              </button>
            </div>
          )}

          <div className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comptes connectés
          </div>
          {accounts.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">Aucun compte. Ajoutez-en dans Paramètres.</p>
          )}
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: a.color || SOURCE_META[a.type]?.color }}
              />
              <span className="flex-1 truncate">{a.name}</span>
              <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                {a.sync_direction === "bidirectional" ? "↔" : a.sync_direction === "push" ? "↑" : a.sync_direction === "pull" ? "↓" : "—"}
              </Badge>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4 sm:py-2.5">
          <Button size="sm" variant="outline" onClick={() => nav(0)}>Auj.</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => nav(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => nav(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="ml-1 truncate text-xs font-semibold capitalize sm:text-sm">{periodLabel()}</h2>

          <div className="ml-auto inline-flex overflow-hidden rounded-md border">
            {(["day", "week", "month", "list"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2 py-1.5 text-xs transition-colors sm:px-3",
                  view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                <span className="sm:hidden">{v === "day" ? "J" : v === "week" ? "Sem" : v === "month" ? "M" : "L"}</span>
                <span className="hidden sm:inline">{v === "day" ? "Jour" : v === "week" ? "Semaine" : v === "month" ? "Mois" : "Liste"}</span>
              </button>
            ))}
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto"
          onTouchStart={(e) => {
            const t = e.touches[0];
            (e.currentTarget as any)._sw = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const s = (e.currentTarget as any)._sw;
            if (!s) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;
            if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) nav(dx < 0 ? 1 : -1);
            (e.currentTarget as any)._sw = null;
          }}
        >
          {view === "month" ? (
            <MonthView cursor={cursor} events={unified} onSelect={setSelected} onPick={setCursor} onLongCreate={openCreate} />
          ) : view === "week" ? (
            <WeekOrDayView days={7} from={startOfWeek(cursor)} events={inRange} onSelect={setSelected} onMove={moveEvent} onLongCreate={openCreate} />
          ) : view === "day" ? (
            <WeekOrDayView days={1} from={startOfDay(cursor)} events={inRange} onSelect={setSelected} onMove={moveEvent} onLongCreate={openCreate} />
          ) : (
            <ListView events={inRange} onSelect={setSelected} />
          )}
        </div>

        {/* Mobile FAB */}
        <Button
          onClick={() => openCreate()}
          className="fixed bottom-20 right-4 z-30 h-14 w-14 rounded-full p-0 shadow-lg md:hidden"
          aria-label="Nouvel événement"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </section>

      {/* RIGHT DETAIL */}
      {selected && (
        <EventDetail
          event={selected}
          account={selected.accountId ? accById.get(selected.accountId) : undefined}
          onClose={() => setSelected(null)}
          onDelete={() => deleteEvent(selected)}
          onCreateTask={() => createTaskFromEvent(selected)}
          onShare={() => shareEvent(selected)}
        />
      )}

      <NewEventDialog
        open={creatingAt !== null}
        onOpenChange={(v) => !v && setCreatingAt(null)}
        accounts={accounts}
        userId={user?.id ?? ""}
        defaultDate={creatingAt ?? cursor}
        onCreated={() => { setCreatingAt(null); load(); }}
      />

    </div>
  );
}

function Legend({ color, badge, label }: { color: string; badge: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 text-xs">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span>{badge}</span>
      <span className="text-foreground/80">{label}</span>
    </div>
  );
}

// ---------- MONTH VIEW ----------
function MonthView({
  cursor,
  events,
  onSelect,
  onPick,
  onLongCreate,
}: {
  cursor: Date;
  events: UnifiedEvent[];
  onSelect: (e: UnifiedEvent) => void;
  onPick: (d: Date) => void;
  onLongCreate?: (d: Date) => void;
}) {
  const first = startOfMonth(cursor);
  const gridStart = startOfWeek(first);
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  return (
    <div className="grid grid-cols-7 border-l border-t">
      {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
        <div key={d} className="border-b border-r bg-muted/40 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {d}
        </div>
      ))}
      {days.map((d) => {
        const dayEvents = events.filter((e) => sameDay(e.start, d));
        const isOther = d.getMonth() !== cursor.getMonth();
        const isToday = sameDay(d, today);
        return (
          <button
            key={d.toISOString()}
            onClick={() => onPick(d)}
            onContextMenu={(e) => { if (onLongCreate) { e.preventDefault(); onLongCreate(d); } }}
            {...useLongPress(() => onLongCreate?.(d))}
            className={cn(
              "min-h-[110px] border-b border-r p-1.5 text-left text-xs transition-colors hover:bg-accent/40",
              isOther && "bg-muted/20 text-muted-foreground",
            )}
          >
            <div className={cn("mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", isToday && "bg-primary font-semibold text-primary-foreground")}>
              {d.getDate()}
            </div>
            <div className="space-y-0.5">
              {dayEvents.slice(0, 3).map((e) => (
                <div
                  key={e.id}
                  onClick={(ev) => { ev.stopPropagation(); onSelect(e); }}
                  className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] text-white"
                  style={{ background: e.color }}
                >
                  <span>{e.badge}</span>
                  <span className="truncate">{e.isAllDay ? "" : fmtTime(e.start) + " "}{e.title}</span>
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} autres</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------- WEEK / DAY VIEW ----------
function WeekOrDayView({
  days,
  from,
  events,
  onSelect,
  onMove,
  onLongCreate,
}: {
  days: number;
  from: Date;
  events: UnifiedEvent[];
  onSelect: (e: UnifiedEvent) => void;
  onMove?: (e: UnifiedEvent, deltaMin: number) => void;
  onLongCreate?: (d: Date) => void;
}) {
  const dayCols = Array.from({ length: days }, (_, i) => addDays(from, i));
  const today = new Date();
  const { startHour, endHour } = useCalendarHours();
  const hourCount = Math.max(1, endHour - startHour);
  const hours = Array.from({ length: hourCount }, (_, i) => startHour + i);
  const ROW_H = 48;
  const [dragOffset, setDragOffset] = useState<{ id: string; dy: number } | null>(null);

  const startDrag = (ev: UnifiedEvent) => (downEvt: React.MouseEvent | React.TouchEvent) => {
    if (!onMove || ev.kind !== "event") return;
    downEvt.stopPropagation();
    const isTouch = "touches" in downEvt;
    const startY = isTouch ? (downEvt as React.TouchEvent).touches[0].clientY : (downEvt as React.MouseEvent).clientY;
    let moved = false;
    let lastY = startY;
    const onMove2 = (clientY: number) => {
      const dy = clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      lastY = clientY;
      setDragOffset({ id: ev.id, dy });
    };
    const onMouseMove = (m: MouseEvent) => onMove2(m.clientY);
    const onTouchMove = (m: TouchEvent) => { m.preventDefault(); onMove2(m.touches[0].clientY); };
    const finish = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      const dy = lastY - startY;
      setDragOffset(null);
      if (moved) {
        const deltaMin = Math.round((dy / ROW_H) * 4) * 15;
        if (deltaMin !== 0) onMove(ev, deltaMin);
      } else {
        onSelect(ev);
      }
    };
    const onMouseUp = () => finish();
    const onTouchEnd = () => finish();
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  };

  return (
    <div className="flex overflow-x-auto">
      <div className="w-14 shrink-0 border-r">
        <div className="h-10 border-b" />
        {hours.map((h) => (
          <div key={h} className="h-12 border-b pr-1 text-right text-[10px] text-muted-foreground">
            {String(h % 24).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      <div className={cn("grid flex-1", days === 1 ? "grid-cols-1 min-w-[280px]" : "grid-cols-7 min-w-[560px]")}>

        {dayCols.map((d) => {
          const dayEvents = events.filter((e) => sameDay(e.start, d));
          const isToday = sameDay(d, today);
          return (
            <div key={d.toISOString()} className="relative border-r">
              <div className={cn("flex h-10 items-center justify-center border-b text-xs font-medium", isToday && "bg-primary/10 text-primary")}>
                {fmtDate(d)}
              </div>
              <div className="relative" style={{ height: hourCount * ROW_H }}>
                {hours.map((h, idx) => (
                  <div key={h} className="absolute left-0 right-0 border-b" style={{ top: idx * ROW_H, height: ROW_H }} />
                ))}
                {(() => {
                  // Compute side-by-side layout for overlapping events
                  const sorted = [...dayEvents].sort(
                    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
                  );
                  type Lay = { col: number; cols: number };
                  const layout = new Map<string, Lay>();
                  let cluster: typeof sorted = [];
                  let clusterEnd = 0;
                  const flush = () => {
                    if (cluster.length === 0) return;
                    const cols: number[] = []; // end time per column
                    const assign = new Map<string, number>();
                    for (const ev of cluster) {
                      const s = ev.start.getTime();
                      let placed = -1;
                      for (let i = 0; i < cols.length; i++) {
                        if (cols[i] <= s) { placed = i; break; }
                      }
                      if (placed === -1) { placed = cols.length; cols.push(0); }
                      cols[placed] = ev.end.getTime();
                      assign.set(ev.id, placed);
                    }
                    const total = cols.length;
                    for (const ev of cluster) layout.set(ev.id, { col: assign.get(ev.id)!, cols: total });
                    cluster = [];
                    clusterEnd = 0;
                  };
                  for (const ev of sorted) {
                    if (cluster.length === 0 || ev.start.getTime() < clusterEnd) {
                      cluster.push(ev);
                      clusterEnd = Math.max(clusterEnd, ev.end.getTime());
                    } else {
                      flush();
                      cluster.push(ev);
                      clusterEnd = ev.end.getTime();
                    }
                  }
                  flush();

                  return dayEvents.map((e) => {
                  const startMin = e.start.getHours() * 60 + e.start.getMinutes();
                  const endMin = Math.max(startMin + 20, e.end.getHours() * 60 + e.end.getMinutes());
                  const winStart = startHour * 60;
                  const winEnd = endHour * 60;
                  if (endMin <= winStart || startMin >= winEnd) return null;
                  const clampedStart = Math.max(startMin, winStart);
                  const clampedEnd = Math.min(endMin, winEnd);
                  const top = ((clampedStart - winStart) / 60) * ROW_H;
                  const h = Math.max(20, ((clampedEnd - clampedStart) / 60) * ROW_H);
                  const dy = dragOffset?.id === e.id ? dragOffset.dy : 0;
                  const draggable = !!onMove && e.kind === "event";
                  const lay = layout.get(e.id) ?? { col: 0, cols: 1 };
                  const widthPct = 100 / lay.cols;
                  const leftPct = lay.col * widthPct;
                  return (
                    <HoverCard key={e.id} openDelay={250} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <div
                          onMouseDown={draggable ? startDrag(e) : undefined}
                          onTouchStart={draggable ? startDrag(e) : undefined}
                          onClick={draggable ? undefined : () => onSelect(e)}
                          className={cn(
                            "absolute select-none overflow-hidden rounded-md p-1 text-left text-[10px] text-white shadow-sm transition-transform hover:scale-[1.01]",
                            draggable && "cursor-grab active:cursor-grabbing",
                            dy !== 0 && "opacity-80 ring-2 ring-primary",
                          )}
                          style={{
                            top: top + dy,
                            height: h,
                            background: e.color,
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                        >
                          <div className="flex items-center gap-1 truncate font-semibold">
                            <span>{e.badge}</span> {e.title}
                          </div>
                          <div className="opacity-90">{fmtTime(e.start)} – {fmtTime(e.end)}</div>
                          {e.location && <div className="flex items-center gap-0.5 truncate opacity-90"><MapPin className="h-2.5 w-2.5" />{e.location}</div>}
                          {e.hasVideo && <div className="flex items-center gap-0.5 opacity-90"><Video className="h-2.5 w-2.5" /> Visio</div>}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent side="right" className="w-72 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
                          <span className="font-semibold">{e.title}</span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {fmtDate(e.start)} · {fmtTime(e.start)} – {fmtTime(e.end)}
                        </div>
                        {e.location && <div className="mt-1 flex items-center gap-1"><MapPin className="h-3 w-3" /> {e.location}</div>}
                        {e.hasVideo && <div className="mt-1 flex items-center gap-1 text-indigo-500"><Video className="h-3 w-3" /> Visioconférence</div>}
                        {e.description && <p className="mt-2 line-clamp-4 whitespace-pre-wrap opacity-80">{e.description}</p>}
                        {draggable && <div className="mt-2 text-[10px] text-muted-foreground">Glisser pour déplacer · Cliquer pour ouvrir</div>}
                      </HoverCardContent>
                    </HoverCard>
                  );
                  });
                })()}

              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ---------- LIST VIEW ----------
function ListView({ events, onSelect }: { events: UnifiedEvent[]; onSelect: (e: UnifiedEvent) => void }) {
  if (events.length === 0)
    return <div className="p-10 text-center text-sm text-muted-foreground">Aucun événement dans cette période.</div>;
  const groups = new Map<string, UnifiedEvent[]>();
  for (const e of events) {
    const k = e.start.toDateString();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return (
    <div className="divide-y">
      {[...groups.entries()].map(([day, items]) => (
        <div key={day} className="p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
          <ul className="space-y-1">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onSelect(e)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                >
                  <div className="h-10 w-1 shrink-0 rounded" style={{ background: e.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span>{e.badge}</span>
                      <span className="truncate font-medium">{e.title}</span>
                      {e.hasVideo && <Video className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtTime(e.start)} – {fmtTime(e.end)}
                      {e.location && <> · <MapPin className="inline h-3 w-3" /> {e.location}</>}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">{e.sourceLabel}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- EVENT DETAIL PANEL ----------
function EventDetail({
  event,
  account,
  onClose,
  onDelete,
  onCreateTask,
  onShare,
}: {
  event: UnifiedEvent;
  account?: Account;
  onClose: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
  onShare?: () => void;
}) {
  const canEdit =
    event.kind === "event" &&
    (!account || account.sync_direction === "bidirectional" || account.sync_direction === "push");

  const participants = extractEmails((event.raw as DbEvent).description ?? "");

  type EmailLite = {
    id: string;
    subject: string | null;
    from_address: string | null;
    from_name: string | null;
    received_at: string | null;
    body_text: string | null;
    body_html: string | null;
  };
  const [linkedEmail, setLinkedEmail] = useState<EmailLite | null>(null);
  const [linkedDocs, setLinkedDocs] = useState<DocumentRow[]>([]);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);

  useEffect(() => {
    setLinkedEmail(null);
    setLinkedDocs([]);
    if (event.kind !== "event") return;
    const evId = (event.raw as DbEvent).id;
    let cancelled = false;
    (async () => {
      // 1) Via meetings linked to this calendar_event
      const { data: mtgs } = await supabase
        .from("meetings")
        .select("id, source_email_id")
        .eq("calendar_event_id", evId);
      const emailId = mtgs?.find((m) => m.source_email_id)?.source_email_id ?? null;
      const meetingIds = (mtgs ?? []).map((m) => m.id);

      // 2) Fetch the linked email
      let email: EmailLite | null = null;
      if (emailId) {
        const { data } = await supabase
          .from("emails")
          .select("id, subject, from_address, from_name, received_at, body_text, body_html")
          .eq("id", emailId)
          .maybeSingle();
        email = (data as EmailLite | null) ?? null;
      }

      // 3) Documents: source_email_id OR source_id in meetingIds
      const docPromises: Promise<{ data: DocumentRow[] | null }>[] = [];
      if (emailId) {
        docPromises.push(
          supabase.from("documents").select("*").eq("source_id", emailId).eq("source_type", "email") as any,
        );
      }
      if (meetingIds.length > 0) {
        docPromises.push(
          supabase.from("documents").select("*").in("source_id", meetingIds).eq("source_type", "meeting") as any,
        );
      }
      const docResults = await Promise.all(docPromises);
      const docMap = new Map<string, DocumentRow>();
      for (const r of docResults) {
        for (const d of r.data ?? []) docMap.set(d.id, d);
      }
      if (cancelled) return;
      setLinkedEmail(email);
      setLinkedDocs(Array.from(docMap.values()));
    })();
    return () => { cancelled = true; };
  }, [event.id]);

  const openDoc = async (d: DocumentRow) => {
    if (!d.storage_path) return;
    try {
      const url = await getSignedUrl(d.storage_path);
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pièce jointe indisponible");
    }
  };


  return (
    <aside className="fixed inset-0 z-40 flex shrink-0 flex-col border-l bg-card lg:relative lg:inset-auto lg:z-auto lg:w-[380px]">
      <header className="flex items-start gap-2 border-b p-4">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: event.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{event.badge}</span>
            <span>{event.sourceLabel}</span>
            {event.kind === "task" && <Badge variant="outline" className="h-4 px-1 text-[9px]">Tâche</Badge>}
          </div>
          <h2 className="mt-1 text-base font-semibold leading-tight">{event.title}</h2>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Quand</div>
          <div>{fmtDate(event.start)}</div>
          <div>{fmtTime(event.start)} – {fmtTime(event.end)}</div>
        </div>

        {event.location && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Lieu</div>
            <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {event.location}</div>
          </div>
        )}

        {event.hasVideo && (
          <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-2 text-xs">
            <Video className="mr-1 inline h-3.5 w-3.5 text-indigo-500" />
            Lien de visioconférence détecté dans la description
          </div>
        )}

        {participants.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              <Users className="mr-1 inline h-3 w-3" /> Participants
            </div>
            <ul className="space-y-1">
              {participants.map((p) => (
                <li key={p}>
                  <a className="text-primary hover:underline" href={`mailto:${p}`}>{p}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {event.description && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap text-foreground/90">{event.description}</p>
          </div>
        )}

        {linkedDocs.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              <Paperclip className="mr-1 inline h-3 w-3" /> Pièces jointes ({linkedDocs.length})
            </div>
            <ul className="space-y-1">
              {linkedDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewDoc(d)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.original_filename || d.filename}</div>
                      <div className="text-[10px] text-muted-foreground">{formatBytes(d.file_size || 0)}</div>
                    </div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => openDoc(d)}
                    disabled={!d.storage_path}
                    aria-label="Télécharger"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {linkedEmail && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Mail className="h-3 w-3" /> Email d'origine
            </div>
            <div className="text-sm font-semibold">{linkedEmail.subject || "(sans objet)"}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {linkedEmail.from_name || linkedEmail.from_address}
              {linkedEmail.received_at && (
                <> · {new Date(linkedEmail.received_at).toLocaleString("fr-FR")}</>
              )}
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto rounded border bg-background p-2 text-xs">
              {linkedEmail.body_html ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: linkedEmail.body_html }}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans">{linkedEmail.body_text || "(vide)"}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      <AttachmentViewerDialog
        doc={previewDoc}
        open={!!previewDoc}
        onOpenChange={(o) => !o && setPreviewDoc(null)}
      />


      <footer className="space-y-2 border-t p-3">
        <Button className="w-full gap-1.5" onClick={onCreateTask}>
          <CheckSquare className="h-4 w-4" /> Créer une tâche liée
        </Button>
        {onShare && (
          <Button variant="outline" className="w-full gap-1.5" onClick={onShare}>
            <Share2 className="h-4 w-4" /> Partager par email
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" className="w-full gap-1.5 text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
        )}
        {!canEdit && event.kind === "event" && (
          <p className="text-center text-[11px] text-muted-foreground">
            Lecture seule (sync « {account?.sync_direction ?? "pull"} »)
          </p>
        )}
      </footer>
    </aside>
  );
}

function extractEmails(s: string): string[] {
  const rx = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  return Array.from(new Set(s.match(rx) ?? []));
}

// ---------- NEW EVENT DIALOG ----------
function NewEventDialog({
  open,
  onOpenChange,
  accounts,
  userId,
  defaultDate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  userId: string;
  defaultDate: Date;
  onCreated: () => void;
}) {
  const writable = accounts.filter(
    (a) => a.sync_direction === "bidirectional" || a.sync_direction === "push",
  );
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState<string>("local");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState("");
  const [recurrence, setRecurrence] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const d = new Date(defaultDate);
      d.setHours(9, 0, 0, 0);
      const e = new Date(d.getTime() + 60 * 60 * 1000);
      const toLocal = (x: Date) =>
        new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setTitle("");
      setStartStr(toLocal(d));
      setEndStr(toLocal(e));
      setAllDay(false);
      setLocation("");
      setParticipants("");
      setRecurrence("none");
      setNotes("");
      setAccountId(writable[0]?.id ?? "local");
    }
  }, [open, defaultDate, writable]);

  const submit = async () => {
    if (!title.trim() || !startStr) {
      toast.error("Titre et date de début requis");
      return;
    }
    setSaving(true);
    try {
      const acc = accounts.find((a) => a.id === accountId);
      const rrule =
        recurrence === "none" ? null :
        recurrence === "daily" ? "FREQ=DAILY" :
        recurrence === "weekly" ? "FREQ=WEEKLY" :
        recurrence === "monthly" ? "FREQ=MONTHLY" : null;

      const parts = participants
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const descBlocks = [
        notes.trim(),
        parts.length > 0 ? `Participants invités : ${parts.join(", ")}` : "",
      ].filter(Boolean).join("\n\n");

      const { error } = await supabase.from("calendar_events").insert({
        user_id: userId,
        account_id: accountId === "local" ? null : accountId,
        title: title.trim(),
        description: descBlocks || null,
        location: location || null,
        start_at: new Date(startStr).toISOString(),
        end_at: new Date(endStr || startStr).toISOString(),
        is_all_day: allDay,
        recurrence_rule: rrule,
        color: acc?.color || "#6366f1",
        source: acc ? (acc.type as never) : null,
        sync_direction: acc?.sync_direction ?? "bidirectional",
      });
      if (error) throw error;

      if (parts.length > 0 && acc) {
        toast.success(`Événement créé · invitations envoyées à ${parts.length} participant${parts.length > 1 ? "s" : ""} via ${acc.name}`);
      } else {
        toast.success("Événement créé");
      }
      onCreated();
      requestAutoSync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvel événement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Calendrier de destination</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">📔 MyHub Pro (local)</SelectItem>
                {writable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {SOURCE_META[a.type]?.badge} {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {writable.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aucun compte en écriture configuré — l'événement restera local.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="ev-title">Titre</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Réunion équipe…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ev-start">Début</Label>
              <Input id="ev-start" type="datetime-local" value={startStr} onChange={(e) => setStartStr(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ev-end">Fin</Label>
              <Input id="ev-end" type="datetime-local" value={endStr} onChange={(e) => setEndStr(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Toute la journée
          </label>

          <div>
            <Label htmlFor="ev-loc">Lieu</Label>
            <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Adresse, salle, ou lien Meet/Zoom/Teams" />
          </div>

          <div>
            <Label htmlFor="ev-part">Participants (emails séparés par virgule)</Label>
            <Input id="ev-part" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="alice@x.com, bob@y.com" />
          </div>

          <div>
            <Label>Récurrence</Label>
            <Select value={recurrence} onValueChange={setRecurrence}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune</SelectItem>
                <SelectItem value="daily">Tous les jours</SelectItem>
                <SelectItem value="weekly">Toutes les semaines</SelectItem>
                <SelectItem value="monthly">Tous les mois</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="ev-notes">Notes</Label>
            <Textarea id="ev-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Création…" : "Créer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
