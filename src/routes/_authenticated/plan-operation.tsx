import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Map as MapIcon,
  ChevronDown,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Filter,
  CalendarDays,
  AlertTriangle,
  Target,
  CheckCircle2,
} from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { cacheGetAll, cacheReplaceAll } from "@/lib/local-cache";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskSource,
  PRIORITY_META,
  getSection,
} from "@/lib/tasks-model";
import { TaskPanel } from "@/components/tasks/task-panel";
export const Route = createFileRoute("/_authenticated/plan-operation")({
  component: PlanOperationPage,
});

type Zoom = "week" | "month" | "quarter" | "year";

const ZOOM_PX: Record<Zoom, number> = { week: 40, month: 14, quarter: 6, year: 2.2 };

const SECTION_DEFS: { key: string; label: string; emoji: string; match: (s: string) => boolean }[] = [
  { key: "CHU", label: "CHU", emoji: "🏥", match: (s) => /chu|hopital|hôpital/i.test(s) },
  { key: "Université", label: "Université", emoji: "🎓", match: (s) => /univ|fac|école|ecole/i.test(s) },
  { key: "Professionnel", label: "Professionnel", emoji: "💼", match: (s) => /pro|travail|work|bureau/i.test(s) },
  { key: "Personnel", label: "Personnel", emoji: "🏠", match: (s) => /perso|personnel|home|maison/i.test(s) },
  { key: "Autres", label: "Autres", emoji: "📧", match: () => true },
];

function sectionOf(label: string): string {
  for (const def of SECTION_DEFS) if (def.match(label)) return def.key;
  return "Autres";
}

type Bar = {
  id: string;
  type: "task";
  title: string;
  start: Date;
  end: Date;
  section: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  source?: TaskSource;
  tags?: string[];
  raw: Task;
};

function PlanOperationPage() {
  const { user } = useAuth();
  const timelineRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // Filters
  const [fPriority, setFPriority] = useState<Set<TaskPriority>>(new Set());
  const [fStatus, setFStatus] = useState<Set<TaskStatus>>(new Set());
  const [fSource, setFSource] = useState<Set<string>>(new Set());
  const [fTag, setFTag] = useState("");

  const dayPx = ZOOM_PX[zoom];

  const load = async () => {
    const cTasks = await cacheGetAll<Task>("tasks");
    if (cTasks.length) setTasks(cTasks);
    setLoading(true);
    if (!navigator.onLine) { setLoading(false); return; }
    const t = await supabase.from("tasks").select("*").neq("status", "archived");
    if (t.error && !cTasks.length) toast.error(t.error.message);
    if (t.data) {
      setTasks(t.data as Task[]);
      cacheReplaceAll("tasks", t.data as Task[]).catch(() => {});
    }
    setLoading(false);
  };
  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => {
    const onOnline = () => { if (user) load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Build bars (tasks only — événements/RDV gérés dans l'Agenda)
  const allBars = useMemo<Bar[]>(() => {
    const out: Bar[] = [];
    tasks.forEach((t) => {
      const s = t.gantt_start ? new Date(t.gantt_start) : (t.due_date ? new Date(t.due_date) : null);
      const e = t.gantt_end ? new Date(t.gantt_end) : (t.due_date ? new Date(t.due_date) : null);
      if (!s || !e) return;
      out.push({
        id: t.id,
        type: "task",
        title: t.title,
        start: s,
        end: e,
        section: sectionOf(getSection(t)),
        priority: t.priority,
        status: t.status,
        source: t.source_app,
        tags: t.tags ?? [],
        raw: t,
      });
    });
    return out;
  }, [tasks]);

  // Apply filters
  const bars = useMemo(() => {
    return allBars.filter((b) => {
      if (fPriority.size && b.priority && !fPriority.has(b.priority)) return false;
      if (fStatus.size && b.status && !fStatus.has(b.status)) return false;
      if (fSource.size && b.source && !fSource.has(b.source)) return false;
      if (fTag.trim()) {
        const q = fTag.toLowerCase();
        const tagHit = (b.tags ?? []).some((tg) => tg.toLowerCase().includes(q));
        const titleHit = b.title.toLowerCase().includes(q);
        if (!tagHit && !titleHit) return false;
      }
      return true;
    });
  }, [allBars, fPriority, fStatus, fSource, fTag]);

  // Indicators
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const taskBars = bars.filter((b) => b.type === "task");
  const doneCount = taskBars.filter((b) => b.status === "done").length;
  const completion = taskBars.length ? Math.round((doneCount / taskBars.length) * 100) : 0;
  const overdue = taskBars.filter((b) => b.end < today && b.status !== "done").length;
  const nextCritical = useMemo(() => {
    return taskBars
      .filter((b) => (b.priority === "urgent" || b.priority === "high") && b.end >= today && b.status !== "done")
      .sort((a, b) => a.end.getTime() - b.end.getTime())[0];
  }, [taskBars, today]);

  // Date range
  const { start, days } = useMemo(() => {
    let min = new Date(today); min.setDate(min.getDate() - 14);
    let max = new Date(today); max.setDate(max.getDate() + 60);
    bars.forEach((b) => {
      if (b.start < min) min = new Date(b.start);
      if (b.end > max) max = new Date(b.end);
    });
    min.setHours(0,0,0,0);
    max.setHours(0,0,0,0);
    const totalDays = Math.ceil((max.getTime() - min.getTime()) / 86400000) + 1;
    return { start: min, days: totalDays };
  }, [bars, today]);

  const dateToX = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 86400000) * dayPx;
  const todayX = dateToX(today);
  const totalWidth = days * dayPx;

  // Header ticks
  const ticks = useMemo(() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const isFirstOfMonth = d.getDate() === 1;
      const isFirstOfQuarter = isFirstOfMonth && d.getMonth() % 3 === 0;
      const isFirstOfYear = isFirstOfMonth && d.getMonth() === 0;
      if (zoom === "week") {
        if (d.getDay() === 1) out.push({ x: i * dayPx, label: `${d.getDate()}/${d.getMonth()+1}`, major: isFirstOfMonth });
      } else if (zoom === "month") {
        if (isFirstOfMonth) out.push({ x: i * dayPx, label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), major: true });
      } else if (zoom === "quarter") {
        if (isFirstOfQuarter) out.push({ x: i * dayPx, label: `T${Math.floor(d.getMonth()/3)+1} ${d.getFullYear()}`, major: true });
      } else {
        if (isFirstOfYear) out.push({ x: i * dayPx, label: String(d.getFullYear()), major: true });
      }
    }
    return out;
  }, [days, start, dayPx, zoom]);

  // Group by section
  const grouped = useMemo(() => {
    const m = new Map<string, Bar[]>();
    SECTION_DEFS.forEach((s) => m.set(s.key, []));
    bars.forEach((b) => { m.get(b.section)!.push(b); });
    return Array.from(m.entries()).filter(([, v]) => v.length > 0);
  }, [bars]);

  const goToday = () => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTo({ left: Math.max(0, todayX - timelineRef.current.clientWidth / 3), behavior: "smooth" });
  };
  useEffect(() => { goToday(); /* eslint-disable-next-line */ }, [zoom, loading]);

  const exportPng = async () => {
    if (!exportRef.current) return;
    try {
      const dataUrl = await toPng(exportRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `plan-operation-${new Date().toISOString().slice(0,10)}.png`;
      a.click();
    } catch (e) { toast.error("Export PNG échoué"); }
  };
  const exportPdf = async () => {
    if (!exportRef.current) return;
    try {
      const dataUrl = await toPng(exportRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));
      const pdf = new jsPDF({ orientation: img.width > img.height ? "landscape" : "portrait", unit: "px", format: [img.width, img.height] });
      pdf.addImage(dataUrl, "PNG", 0, 0, img.width, img.height);
      pdf.save(`plan-operation-${new Date().toISOString().slice(0,10)}.pdf`);
    } catch { toast.error("Export PDF échoué"); }
  };

  const handleBarClick = (b: Bar) => {
    if (b.type === "task") { setEditing(b.raw as Task); setPanelOpen(true); }
  };

  const handleUpdateRange = async (b: Bar, s: Date, e: Date) => {
    if (b.type !== "task") return;
    const payload = { gantt_start: s.toISOString(), gantt_end: e.toISOString(), due_date: e.toISOString() };
    setTasks((prev) => prev.map((t) => (t.id === b.id ? { ...t, ...payload } : t)));
    const { error } = await supabase.from("tasks").update(payload).eq("id", b.id);
    if (error) toast.error(error.message);
  };

  const toggleSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const ROW_H = 30;
  const SECTION_H = 32;
  const LABEL_W = 240;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MapIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-semibold tracking-tight">Plan d'opération</h1>
          <p className="text-sm text-muted-foreground">{bars.length} éléments · {grouped.length} sections</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday} className="gap-1">
            <CalendarDays className="h-4 w-4" /> Aujourd'hui
          </Button>
          <div className="inline-flex overflow-hidden rounded-md border">
            {(["week","month","quarter","year"] as Zoom[]).map((z) => (
              <button key={z} onClick={() => setZoom(z)}
                className={cn("px-3 py-1.5 text-xs", zoom === z ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {z === "week" ? "Semaine" : z === "month" ? "Mois" : z === "quarter" ? "Trimestre" : "Année"}
              </button>
            ))}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Filter className="h-4 w-4" /> Filtres
                {(fPriority.size + fStatus.size + fSource.size + (fTag ? 1 : 0)) > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {fPriority.size + fStatus.size + fSource.size + (fTag ? 1 : 0)}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="end">
              <div>
                <Label className="text-xs">Priorité</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(Object.keys(PRIORITY_META) as TaskPriority[]).map((p) => (
                    <label key={p} className="flex items-center gap-1 text-xs">
                      <Checkbox checked={fPriority.has(p)} onCheckedChange={() => setFPriority(toggleSet(fPriority, p))} />
                      {PRIORITY_META[p].emoji} {PRIORITY_META[p].label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Statut</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["todo","in_progress","done"] as TaskStatus[]).map((s) => (
                    <label key={s} className="flex items-center gap-1 text-xs">
                      <Checkbox checked={fStatus.has(s)} onCheckedChange={() => setFStatus(toggleSet(fStatus, s))} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Source</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {["myhubpro","microsoft_todo","apple_reminders","calendar"].map((s) => (
                    <label key={s} className="flex items-center gap-1 text-xs">
                      <Checkbox checked={fSource.has(s)} onCheckedChange={() => setFSource(toggleSet(fSource, s))} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Tag / Titre</Label>
                <Input value={fTag} onChange={(e) => setFTag(e.target.value)} placeholder="Rechercher…" className="mt-1 h-8 text-xs" />
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => { setFPriority(new Set()); setFStatus(new Set()); setFSource(new Set()); setFTag(""); }}>
                Réinitialiser
              </Button>
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" onClick={exportPng} className="gap-1"><ImageIcon className="h-4 w-4" /> PNG</Button>
          <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1"><Download className="h-4 w-4" /> PDF</Button>
        </div>
      </div>

      {/* Indicators */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Complétion globale</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{completion}%</span>
            <span className="text-xs text-muted-foreground">{doneCount}/{taskBars.length} tâches</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${completion}%` }} />
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> En retard</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn("text-2xl font-semibold", overdue > 0 && "text-red-500")}>{overdue}</span>
            {overdue > 0 && <Badge variant="destructive" className="text-[10px]">urgent</Badge>}
          </div>
        </div>
        <div className={cn("rounded-xl border bg-card p-3", nextCritical && "ring-2 ring-amber-500/40")}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Target className="h-3.5 w-3.5" /> Prochaine échéance critique</div>
          {nextCritical ? (
            <div className="mt-1">
              <div className="truncate text-sm font-semibold">{nextCritical.title}</div>
              <div className="text-xs text-muted-foreground">
                {nextCritical.end.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">Aucune</div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-muted/30 p-12 text-center text-sm text-muted-foreground">Chargement…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-12 text-center text-sm text-muted-foreground">Aucun élément à afficher</div>
      ) : (
        <div ref={exportRef} className="rounded-xl border bg-card">
          <div ref={timelineRef} className="flex max-h-[calc(100vh-22rem)] overflow-auto">
            {/* Left labels */}
            <div className="sticky left-0 z-20 shrink-0 border-r bg-card" style={{ width: LABEL_W }}>
              <div className="h-10 border-b bg-muted/30" />
              {grouped.map(([sectionKey, items]) => {
                const def = SECTION_DEFS.find((d) => d.key === sectionKey)!;
                const isCollapsed = collapsed[sectionKey];
                return (
                  <div key={sectionKey}>
                    <button
                      onClick={() => setCollapsed((p) => ({ ...p, [sectionKey]: !p[sectionKey] }))}
                      className="flex w-full items-center gap-1 border-b bg-muted/50 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                      style={{ height: SECTION_H }}
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span>{def.emoji} {def.label}</span>
                      <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">{items.length}</Badge>
                    </button>
                    {!isCollapsed && items.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 border-b px-3 text-xs" style={{ height: ROW_H }}>
                        <span className={cn("h-2 w-2 rounded-full", b.priority ? PRIORITY_META[b.priority].dot : "bg-muted-foreground")} />
                        <span className="truncate">{b.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Timeline */}
            <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
              <div className="sticky top-0 z-10 h-10 border-b bg-card">
                {ticks.map((t, i) => (
                  <div key={i}
                    className={cn("absolute top-0 h-full border-l text-[10px]", t.major ? "border-foreground/30 font-semibold" : "border-border")}
                    style={{ left: t.x }}>
                    <span className="ml-1 mt-1 inline-block whitespace-nowrap text-muted-foreground">{t.label}</span>
                  </div>
                ))}
              </div>

              {/* Today line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div className="pointer-events-none absolute top-10 z-20 bottom-0 border-l-2 border-red-500" style={{ left: todayX }}>
                  <span className="absolute -left-5 -top-3 rounded bg-red-500 px-1 text-[9px] font-bold text-white">AUJ.</span>
                </div>
              )}

              {/* Overdue zone overlay per row drawn inside rows */}
              <div>
                {grouped.map(([sectionKey, items]) => {
                  const isCollapsed = collapsed[sectionKey];
                  return (
                    <div key={sectionKey}>
                      <div className="border-b bg-muted/20" style={{ height: SECTION_H }} />
                      {!isCollapsed && items.map((b) => (
                        <BarRow key={b.id} bar={b} rowHeight={ROW_H} dayPx={dayPx} start={start} today={today}
                          onClick={() => handleBarClick(b)}
                          onUpdateRange={(s, e) => handleUpdateRange(b, s, e)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <TaskPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        task={editing}
        sections={[]}
        onSaved={(saved) => { setTasks((prev) => { const i = prev.findIndex((t) => t.id === saved.id); if (i >= 0) { const n = [...prev]; n[i] = saved; return n; } return [saved, ...prev]; }); }}
      />
    </div>
  );
}

function BarRow({
  bar, rowHeight, dayPx, start, today, onClick, onUpdateRange,
}: {
  bar: Bar;
  rowHeight: number;
  dayPx: number;
  start: Date;
  today: Date;
  onClick: () => void;
  onUpdateRange: (s: Date, e: Date) => void;
}) {
  const [drag, setDrag] = useState<null | { mode: "move" | "resize-l" | "resize-r"; startX: number; origStart: Date; origEnd: Date }>(null);
  const [preview, setPreview] = useState<{ s: Date; e: Date } | null>(null);

  const cur = preview ?? { s: bar.start, e: bar.end };
  const left = Math.floor((cur.s.getTime() - start.getTime()) / 86400000) * dayPx;
  const days = Math.max(1, Math.ceil((cur.e.getTime() - cur.s.getTime()) / 86400000) + 1);
  const width = Math.max(dayPx, days * dayPx);

  const isOverdue = bar.end < today && bar.status !== "done";
  const isDone = bar.status === "done";

  const barColor = bar.priority ? PRIORITY_META[bar.priority].bar : "bg-muted-foreground";

  const onPointerDown = (mode: "move" | "resize-l" | "resize-r") => (ev: React.PointerEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ mode, startX: ev.clientX, origStart: bar.start, origEnd: bar.end });
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dDays = Math.round(dx / dayPx);
    if (dDays === 0) { setPreview(null); return; }
    let ns = new Date(drag.origStart), ne = new Date(drag.origEnd);
    if (drag.mode === "move") { ns.setDate(ns.getDate() + dDays); ne.setDate(ne.getDate() + dDays); }
    if (drag.mode === "resize-l") { ns.setDate(ns.getDate() + dDays); if (ns > ne) ns = new Date(ne); }
    if (drag.mode === "resize-r") { ne.setDate(ne.getDate() + dDays); if (ne < ns) ne = new Date(ns); }
    setPreview({ s: ns, e: ne });
  };
  const onPointerUp = () => {
    if (drag && preview) onUpdateRange(preview.s, preview.e);
    setDrag(null); setPreview(null);
  };

  // Overdue zone (red transparent) from end to today
  const overdueLeft = isOverdue ? Math.floor((bar.end.getTime() - start.getTime()) / 86400000) * dayPx : 0;
  const overdueWidth = isOverdue ? Math.max(0, Math.floor((today.getTime() - bar.end.getTime()) / 86400000) * dayPx) : 0;

  return (
    <div className="relative border-b" style={{ height: rowHeight }}>
      {overdueWidth > 0 && (
        <div className="pointer-events-none absolute top-0 h-full bg-red-500/15" style={{ left: overdueLeft, width: overdueWidth }} />
      )}
      <div
        title={`${bar.title} — ${cur.s.toLocaleDateString()} → ${cur.e.toLocaleDateString()}`}
        onClick={(ev) => { if (!drag) { ev.stopPropagation(); onClick(); } }}
        onPointerDown={onPointerDown("move")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "group absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded px-2 text-[10px] font-medium text-white shadow-sm cursor-grab active:cursor-grabbing",
          barColor,
          isDone && "opacity-60",
          isOverdue && "ring-1 ring-red-600",
        )}
        style={{ left, width }}
      >
        <span onPointerDown={onPointerDown("resize-l")} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" />
        <span className="truncate">{bar.title}</span>
        <span onPointerDown={onPointerDown("resize-r")} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
      </div>
    </div>
  );
}

