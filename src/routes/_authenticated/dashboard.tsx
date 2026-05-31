import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sun, Cloud, CloudRain, CloudSnow, Wind,
  Mail, ListTodo, Calendar as CalIcon, Sparkles, RefreshCw, Zap,
  GripVertical, Settings2, Plus, Video, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { generateDashboardInsights } from "@/lib/api/dashboard-insights.functions";
import { cacheGetAll, cacheReplaceAll } from "@/lib/local-cache";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { relativeTime } from "@/lib/relative-time";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types & persistence
// ─────────────────────────────────────────────────────────────────────────────
type WidgetId = "hello" | "emails" | "tasks" | "agenda" | "ai" | "sync" | "quick";
type Layout = { order: WidgetId[]; hidden: WidgetId[]; columns: 2 | 3 };

const DEFAULT_LAYOUT: Layout = {
  order: ["hello", "emails", "tasks", "agenda", "ai", "sync", "quick"],
  hidden: [],
  columns: 3,
};
const STORAGE_KEY = "myhubpro.dashboard.layout";

function loadLayout(): Layout {
  if (typeof localStorage === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const p = JSON.parse(raw) as Layout;
    // Validate
    const valid: WidgetId[] = ["hello", "emails", "tasks", "agenda", "ai", "sync", "quick"];
    const order = p.order?.filter((w) => valid.includes(w)) ?? DEFAULT_LAYOUT.order;
    valid.forEach((w) => { if (!order.includes(w)) order.push(w); });
    return { order, hidden: p.hidden ?? [], columns: p.columns === 2 ? 2 : 3 };
  } catch { return DEFAULT_LAYOUT; }
}
function saveLayout(l: Layout) { localStorage.setItem(STORAGE_KEY, JSON.stringify(l)); }

const QUICK_ACTIONS_KEY = "myhubpro.dashboard.quick";
type QuickAction = { label: string; to: string };
const DEFAULT_QUICK: QuickAction[] = [
  { label: "Nouvelle tâche", to: "/tasks" },
  { label: "Inbox CHU", to: "/inbox" },
  { label: "Voir Gantt", to: "/plan-operation" },
  { label: "Contacts", to: "/contacts" },
];
function loadQuick(): QuickAction[] {
  try {
    const raw = localStorage.getItem(QUICK_ACTIONS_KEY);
    if (!raw) return DEFAULT_QUICK;
    return JSON.parse(raw);
  } catch { return DEFAULT_QUICK; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable wrapper
// ─────────────────────────────────────────────────────────────────────────────
function SortableWidget({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="relative group min-w-0 max-w-full"
    >
      <button
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        aria-label="Déplacer le widget"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
function DashboardPage() {
  const { user } = useAuth();
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => { saveLayout(layout); }, [layout]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visibleOrder = layout.order.filter((w) => !layout.hidden.includes(w));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setLayout((l) => {
      const oldIdx = l.order.indexOf(active.id as WidgetId);
      const newIdx = l.order.indexOf(over.id as WidgetId);
      return { ...l, order: arrayMove(l.order, oldIdx, newIdx) };
    });
  };

  const widgets: Record<WidgetId, React.ReactNode> = {
    hello: <HelloWidget />,
    emails: <EmailsWidget userId={user?.id} />,
    tasks: <TasksWidget userId={user?.id} />,
    agenda: <AgendaWidget userId={user?.id} />,
    ai: <AIInsightsWidget userId={user?.id} />,
    sync: <SyncStatusWidget />,
    quick: <QuickActionsWidget />,
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-semibold">Dashboard</h1>
        <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-2" /> Personnaliser
            </Button>
          </DialogTrigger>
          <CustomizeDialog layout={layout} setLayout={setLayout} />
        </Dialog>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
          <div className={cn(
            "min-w-0 max-w-full gap-4 [column-fill:_balance]",
            layout.columns === 2
              ? "columns-1 md:columns-2"
              : "columns-1 md:columns-2 xl:columns-3"
          )}>
            {visibleOrder.map((w) => (
              <div key={w} className="mb-4 min-w-0 max-w-full break-inside-avoid overflow-hidden">
                <SortableWidget id={w}>{widgets[w]}</SortableWidget>
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customize dialog
// ─────────────────────────────────────────────────────────────────────────────
const WIDGET_LABELS: Record<WidgetId, string> = {
  hello: "Bonjour + météo",
  emails: "Résumé emails",
  tasks: "Tâches du jour",
  agenda: "Agenda",
  ai: "IA Insights",
  sync: "Statut sync",
  quick: "Accès rapides",
};

function CustomizeDialog({ layout, setLayout }: { layout: Layout; setLayout: (l: Layout) => void }) {
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Personnaliser le dashboard</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium mb-2">Widgets visibles</div>
          <div className="space-y-2">
            {(["hello", "emails", "tasks", "agenda", "ai", "sync", "quick"] as WidgetId[]).map((w) => (
              <label key={w} className="flex items-center justify-between text-sm">
                <span>{WIDGET_LABELS[w]}</span>
                <Switch
                  checked={!layout.hidden.includes(w)}
                  onCheckedChange={(v) => setLayout({
                    ...layout,
                    hidden: v ? layout.hidden.filter((x) => x !== w) : [...layout.hidden, w],
                  })}
                />
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Colonnes</div>
          <div className="flex gap-2">
            <Button variant={layout.columns === 2 ? "default" : "outline"} size="sm" onClick={() => setLayout({ ...layout, columns: 2 })}>2 colonnes</Button>
            <Button variant={layout.columns === 3 ? "default" : "outline"} size="sm" onClick={() => setLayout({ ...layout, columns: 3 })}>3 colonnes</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Astuce : glisse-dépose les widgets sur le dashboard pour les réorganiser.</p>
      </div>
    </DialogContent>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 1 — Hello + weather
// ─────────────────────────────────────────────────────────────────────────────
function HelloWidget() {
  const { user } = useAuth();
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<{ temp: number; code: number; loading: boolean; error?: string }>({ temp: 0, code: 0, loading: true });

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setWeather((w) => ({ ...w, loading: false, error: "no geo" }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current=temperature_2m,weather_code`);
          const j = await r.json();
          setWeather({ temp: Math.round(j.current?.temperature_2m ?? 0), code: j.current?.weather_code ?? 0, loading: false });
        } catch { setWeather((w) => ({ ...w, loading: false, error: "fetch" })); }
      },
      () => setWeather((w) => ({ ...w, loading: false, error: "denied" })),
      { timeout: 5000 },
    );
  }, []);

  const firstName = (user?.user_metadata?.display_name as string | undefined)?.split(" ")[0]
    ?? user?.email?.split("@")[0] ?? "";
  const dateStr = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const WeatherIcon = weatherCodeIcon(weather.code);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Bonjour {firstName}</h2>
            <p className="text-sm text-muted-foreground capitalize">{dateStr}</p>
            <p className="text-3xl font-light tabular-nums mt-2">{timeStr}</p>
          </div>
          <div className="text-right">
            {weather.loading ? (
              <div className="text-xs text-muted-foreground">Météo…</div>
            ) : weather.error ? (
              <div className="text-xs text-muted-foreground">Météo indispo</div>
            ) : (
              <div className="flex flex-col items-center">
                <WeatherIcon className="h-10 w-10 text-primary" />
                <div className="text-2xl font-semibold tabular-nums">{weather.temp}°</div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function weatherCodeIcon(code: number) {
  if (code === 0 || code === 1) return Sun;
  if (code >= 2 && code <= 3) return Cloud;
  if (code >= 45 && code <= 48) return Wind;
  if (code >= 51 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 99) return CloudRain;
  return Cloud;
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 2 — Emails summary
// ─────────────────────────────────────────────────────────────────────────────
function EmailsWidget({ userId }: { userId?: string }) {
  type EmailRow = { id: string; from_name: string | null; from_address: string | null; subject: string | null; is_read: boolean; account_id: string; received_at: string | null };
  type AccountRow = { id: string; name: string; color: string | null; credentials?: { calendar_only?: boolean } | null };
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      // 1. Cache first
      const [cachedEmails, cachedAccounts] = await Promise.all([
        cacheGetAll<EmailRow>("emails"),
        cacheGetAll<AccountRow>("accounts"),
      ]);
      if (cachedEmails.length) setEmails(cachedEmails.slice(0, 50));
      if (cachedAccounts.length) setAccounts(cachedAccounts.filter((a) => !(a.credentials?.calendar_only === true)));
      // 2. Network refresh
      if (!navigator.onLine) return;
      const [emailsRes, accountsRes] = await Promise.all([
        supabase.from("emails").select("id, from_name, from_address, subject, is_read, account_id, received_at").order("received_at", { ascending: false }).limit(50),
        supabase.from("accounts").select("id, name, color, credentials").eq("user_id", userId),
      ]);
      if (emailsRes.data) { setEmails(emailsRes.data); cacheReplaceAll("emails", emailsRes.data).catch(() => {}); }
      if (accountsRes.data) {
        const filtered = (accountsRes.data as AccountRow[]).filter((a) => !(a.credentials?.calendar_only === true));
        setAccounts(filtered);
        cacheReplaceAll("accounts", accountsRes.data).catch(() => {});
      }

    })();
  }, [userId]);

  const unreadByAccount = useMemo(() => {
    const m: Record<string, number> = {};
    emails.forEach((e) => { if (!e.is_read) m[e.account_id] = (m[e.account_id] ?? 0) + 1; });
    return m;
  }, [emails]);
  const latest = emails.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> Emails du jour</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <Badge key={a.id} variant="secondary" style={{ backgroundColor: a.color ?? undefined, color: a.color ? "#fff" : undefined }}>
              {a.name} · {unreadByAccount[a.id] ?? 0}
            </Badge>
          ))}
          {accounts.length === 0 && <span className="text-xs text-muted-foreground">Aucun compte</span>}
        </div>
        <div className="space-y-1">
          {latest.length === 0 && <p className="text-xs text-muted-foreground">Aucun email récent</p>}
          {latest.map((e) => (
            <div key={e.id} className="text-sm border-l-2 pl-2 border-border">
              <div className="font-medium truncate">{e.from_name ?? e.from_address ?? "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{e.subject ?? "(sans sujet)"}</div>
            </div>
          ))}
        </div>
        <Button asChild variant="ghost" size="sm" className="w-full"><Link to="/inbox">Voir tous</Link></Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 3 — Tasks
// ─────────────────────────────────────────────────────────────────────────────
function TasksWidget({ userId }: { userId?: string }) {
  type Task = { id: string; title: string; due_date: string | null; priority: string; status: string };
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    // 1. cache
    const cached = await cacheGetAll<Task>("tasks");
    if (cached.length) setTasks(cached as Task[]);
    // 2. network
    if (!navigator.onLine) return;
    const { data } = await supabase.from("tasks").select("id, title, due_date, priority, status").order("due_date", { ascending: true, nullsFirst: false }).limit(200);
    if (data) setTasks(data);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dueToday = tasks.filter((t) => t.due_date && new Date(t.due_date) >= today && new Date(t.due_date) < tomorrow);
  const overdue = tasks.filter((t) => t.due_date && new Date(t.due_date) < today && t.status !== "done");
  const urgent = tasks.filter((t) => (t.priority === "urgent" || t.priority === "high") && t.status !== "done").slice(0, 5);
  const todayDone = dueToday.filter((t) => t.status === "done").length;
  const todayPct = dueToday.length > 0 ? Math.round((todayDone / dueToday.length) * 100) : 0;

  const quickAdd = async () => {
    if (!newTitle.trim() || !userId) return;
    const { error } = await supabase.from("tasks").insert({
      title: newTitle.trim(), user_id: userId, priority: "medium", status: "todo", source_app: "myhubpro",
    });
    if (error) toast.error("Impossible d'ajouter"); else { toast.success("Tâche ajoutée"); setNewTitle(""); load(); requestAutoSync(); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ListTodo className="h-4 w-4" /> Tâches du jour</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{dueToday.length} aujourd'hui · {todayDone} terminée(s)</span>
          {overdue.length > 0 && <Badge variant="destructive">{overdue.length} en retard</Badge>}
        </div>
        <Progress value={todayPct} className="h-2" />
        <div className="space-y-1">
          {dueToday.length === 0 && urgent.length === 0 && <p className="text-xs text-muted-foreground">Aucune tâche prioritaire</p>}
          {[...dueToday, ...urgent.filter((u) => !dueToday.some((d) => d.id === u.id))].slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className={cn("h-2 w-2 rounded-full", t.priority === "urgent" ? "bg-destructive" : t.priority === "high" ? "bg-orange-500" : "bg-muted-foreground")} />
              <span className={cn("flex-1 truncate", t.status === "done" && "line-through text-muted-foreground")}>{t.title}</span>
              {t.due_date && new Date(t.due_date) < today && t.status !== "done" && <Badge variant="destructive" className="text-[10px]">Retard</Badge>}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="＋ Nouvelle tâche rapide" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && quickAdd()} className="h-8 text-sm" />
          <Button size="sm" onClick={quickAdd}><Plus className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 4 — Agenda
// ─────────────────────────────────────────────────────────────────────────────
function AgendaWidget({ userId }: { userId?: string }) {
  type Evt = { id: string; title: string; start_at: string; end_at: string; location: string | null; description: string | null };
  const [events, setEvents] = useState<Evt[]>([]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      // 1. cache (filter to today/tomorrow window)
      const cached = await cacheGetAll<Evt>("calendar_events");
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 2);
      if (cached.length) {
        setEvents(cached.filter((e) => {
          const t = new Date(e.start_at).getTime();
          return t >= start.getTime() && t < end.getTime();
        }));
      }
      // 2. network
      if (!navigator.onLine) return;
      const { data } = await supabase.from("calendar_events")
        .select("id, title, start_at, end_at, location, description")
        .gte("start_at", start.toISOString()).lt("start_at", end.toISOString()).order("start_at");
      if (data) setEvents(data);
    })();
  }, [userId]);

  const now = new Date();
  const startOfTomorrow = new Date(); startOfTomorrow.setHours(0, 0, 0, 0); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const today = events.filter((e) => new Date(e.start_at) < startOfTomorrow);
  const tomorrow = events.filter((e) => new Date(e.start_at) >= startOfTomorrow);
  const next = today.find((e) => new Date(e.start_at) > now);
  const hasVideo = (e: Evt) => /meet\.google\.com|teams\.microsoft\.com|zoom\.us/.test(`${e.location ?? ""} ${e.description ?? ""}`);

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CalIcon className="h-4 w-4" /> Agenda</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {next && (
          <div className="rounded-md bg-primary/10 p-2 text-sm border border-primary/20">
            <div className="text-xs text-primary font-medium">Prochain · {relativeTime(next.start_at)}</div>
            <div className="font-medium truncate flex items-center gap-1">{next.title} {hasVideo(next) && <Video className="h-3 w-3" />}</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted-foreground mb-1">Aujourd'hui</div>
          {today.length === 0 && <p className="text-xs text-muted-foreground">Aucun événement</p>}
          {today.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm">
              <span className="text-xs tabular-nums text-muted-foreground w-12">{new Date(e.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="truncate flex-1">{e.title}</span>
              {hasVideo(e) && <Video className="h-3 w-3 text-primary" />}
            </div>
          ))}
        </div>
        {tomorrow.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Demain</div>
            {tomorrow.slice(0, 3).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm opacity-60">
                <span className="text-xs tabular-nums w-12">{new Date(e.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="truncate flex-1">{e.title}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 5 — AI Insights
// ─────────────────────────────────────────────────────────────────────────────
function AIInsightsWidget({ userId }: { userId?: string }) {
  const generate = useServerFn(generateDashboardInsights);
  const [insights, setInsights] = useState<{ summary: string; suggestions: string[]; alerts: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const now = new Date();
      const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
      const [emailsRes, tasksRes, eventsRes] = await Promise.all([
        supabase.from("emails").select("subject, is_read").eq("is_read", false).limit(50),
        supabase.from("tasks").select("title, due_date, status, priority").neq("status", "done").limit(100),
        supabase.from("calendar_events").select("id").gte("start_at", new Date(now.setHours(0, 0, 0, 0)).toISOString()).lt("start_at", new Date(now.getTime() + 86400000).toISOString()),
      ]);
      const unread = emailsRes.data ?? [];
      const tasks = tasksRes.data ?? [];
      const overdue = tasks.filter((t) => t.due_date && new Date(t.due_date) < new Date()).length;
      const dueSoon = tasks.filter((t) => t.due_date && new Date(t.due_date) <= in48h && new Date(t.due_date) >= new Date());
      const urgentSubjects = unread.filter((_, i) => i < 10).map((e) => e.subject ?? "").filter(Boolean);

      const res = await generate({ data: {
        unreadCount: unread.length,
        urgentEmailSubjects: urgentSubjects,
        tasksDueSoon: dueSoon.map((t) => ({ title: t.title, due_date: t.due_date })),
        overdueCount: overdue,
        todayEvents: (eventsRes.data ?? []).length,
      }});
      setInsights(res);
    } catch (e) {
      toast.error("Insights IA indisponibles");
    } finally { setLoading(false); }
  }, [userId, generate]);

  useEffect(() => { run(); }, [run]);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> IA Insights</CardTitle>
        <Button variant="ghost" size="icon" onClick={run} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading && !insights && <p className="text-xs text-muted-foreground">Analyse en cours…</p>}
        {insights && (
          <>
            <p className="font-medium leading-snug">{insights.summary}</p>
            {insights.suggestions.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Suggestions</div>
                <ul className="space-y-1">{insights.suggestions.map((s, i) => <li key={i} className="flex gap-2 text-xs"><CheckCircle2 className="h-3 w-3 mt-0.5 text-primary shrink-0" /><span>{s}</span></li>)}</ul>
              </div>
            )}
            {insights.alerts.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Alertes</div>
                <ul className="space-y-1">{insights.alerts.map((s, i) => <li key={i} className="flex gap-2 text-xs"><AlertTriangle className="h-3 w-3 mt-0.5 text-destructive shrink-0" /><span>{s}</span></li>)}</ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 6 — Sync status
// ─────────────────────────────────────────────────────────────────────────────
function SyncStatusWidget() {
  const { user } = useAuth();
  const { syncing, syncNow } = useSyncStatus();
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; last_sync_at: string | null; is_active: boolean }>>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("accounts").select("id, name, last_sync_at, is_active, credentials").eq("user_id", user.id);
    setAccounts((data ?? []).filter((a: any) => !(a.credentials?.calendar_only === true)));

  }, [user]);
  useEffect(() => { load(); }, [load]);

  const health = useMemo(() => {
    if (accounts.length === 0) return "neutral";
    const now = Date.now();
    const stale = accounts.filter((a) => !a.last_sync_at || now - new Date(a.last_sync_at).getTime() > 60 * 60 * 1000).length;
    if (stale === 0) return "ok";
    if (stale === accounts.length) return "bad";
    return "warn";
  }, [accounts]);

  const dotClass = health === "ok" ? "bg-green-500" : health === "warn" ? "bg-orange-500" : health === "bad" ? "bg-destructive" : "bg-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4" /> Synchronisation</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2 w-2 rounded-full", dotClass)} />
          <span>{health === "ok" ? "Toutes les sources à jour" : health === "warn" ? "Certaines sources en retard" : health === "bad" ? "Sources non synchronisées" : "Aucune source"}</span>
        </div>
        <div className="space-y-1">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="truncate">{a.name}</span>
              <span className="text-muted-foreground">{a.last_sync_at ? relativeTime(a.last_sync_at) : "jamais"}</span>
            </div>
          ))}
        </div>
        <Button size="sm" className="w-full" disabled={syncing} onClick={async () => { await syncNow(); load(); }}>
          <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} /> Tout synchroniser
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET 7 — Quick actions
// ─────────────────────────────────────────────────────────────────────────────
function QuickActionsWidget() {
  const [actions, setActions] = useState<QuickAction[]>(loadQuick);
  const [editing, setEditing] = useState(false);

  const save = (next: QuickAction[]) => {
    setActions(next);
    localStorage.setItem(QUICK_ACTIONS_KEY, JSON.stringify(next));
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4" /> Accès rapides</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)}>{editing ? "OK" : "Éditer"}</Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a, i) => editing ? (
            <div key={i} className="space-y-1">
              <Input value={a.label} onChange={(e) => save(actions.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className="h-8 text-xs" />
              <Input value={a.to} onChange={(e) => save(actions.map((x, j) => j === i ? { ...x, to: e.target.value } : x))} className="h-8 text-xs" placeholder="/inbox" />
            </div>
          ) : (
            <Button key={i} asChild variant="outline" size="sm" className="justify-start h-auto py-2">
              <Link to={a.to}>{a.label}</Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
