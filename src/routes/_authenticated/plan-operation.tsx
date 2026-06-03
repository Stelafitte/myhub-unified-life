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
  Trash2,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { enqueue, requestAutoSync } from "@/lib/sync-queue";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskSource,
  PRIORITY_META,
  getSection,
  withoutSection,
} from "@/lib/tasks-model";
import { TaskPanel } from "@/components/tasks/task-panel";
import { MobilePlanView, type MobileBar } from "@/components/plan/mobile-plan-view";
export const Route = createFileRoute("/_authenticated/plan-operation")({
  component: PlanOperationPage,
});

type Zoom = "week" | "month" | "quarter" | "year";

const ZOOM_PX: Record<Zoom, number> = { week: 40, month: 14, quarter: 6, year: 2.2 };

type SectionDef = { key: string; label: string; emoji: string; match?: (s: string) => boolean; alwaysShow?: boolean };

const LEGACY_SECTIONS: SectionDef[] = [
  { key: "CHU", label: "CHU", emoji: "🏥", match: (s) => /chu|hopital|hôpital/i.test(s) },
  { key: "Université", label: "Université", emoji: "🎓", match: (s) => /univ|fac|école|ecole/i.test(s) },
  { key: "Professionnel", label: "Professionnel", emoji: "💼", match: (s) => /pro|travail|work|bureau/i.test(s) },
  { key: "Personnel", label: "Personnel", emoji: "🏠", match: (s) => /perso|personnel|home|maison/i.test(s) },
  { key: "Autres", label: "Autres", emoji: "📧", match: () => true },
];

function buildSectionOf(allSections: SectionDef[]) {
  return (label: string): string => {
    // Exact match (theme name) wins
    const exact = allSections.find((d) => d.key === label);
    if (exact) return exact.key;
    for (const def of allSections) if (def.match && def.match(label)) return def.key;
    return "Autres";
  };
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

// Couleur basée sur la proximité de la date d'échéance.
// Retourne null pour conserver la couleur par défaut (priorité).
function urgencyBarClass(end: Date, today: Date): string | null {
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "bg-red-700";   // en retard
  if (days <= 1) return "bg-red-600";  // aujourd'hui / demain
  if (days <= 3) return "bg-red-500";
  if (days <= 7) return "bg-orange-500";
  if (days <= 14) return "bg-amber-500";
  return null;
}

function PlanOperationPage() {
  const { user } = useAuth();
  const timelineRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ id: string; ts: number } | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [toDelete, setToDelete] = useState<Task | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [opThemes, setOpThemes] = useState<{ id: string; name: string; position: number; show_in_plan?: boolean }[]>([]);
  const [opSubthemes, setOpSubthemes] = useState<{ id: string; name: string; theme_id: string; position: number; show_in_plan?: boolean }[]>([]);

  // Sections dynamiques : un thème est visible s'il est marqué show_in_plan
  // OU si l'un de ses sous-thèmes est marqué show_in_plan.
  const SECTION_DEFS = useMemo<SectionDef[]>(() => {
    const visibleThemeIds = new Set<string>();
    opThemes.forEach((t) => { if (t.show_in_plan) visibleThemeIds.add(t.id); });
    opSubthemes.forEach((s) => { if (s.show_in_plan) visibleThemeIds.add(s.theme_id); });
    const themeSecs: SectionDef[] = opThemes.map((t) => ({
      key: t.name, label: t.name, emoji: "📋",
      alwaysShow: visibleThemeIds.has(t.id),
    }));
    return [...themeSecs, ...LEGACY_SECTIONS];
  }, [opThemes, opSubthemes]);
  const sectionOf = useMemo(() => buildSectionOf(SECTION_DEFS), [SECTION_DEFS]);

  // Déplacer une tâche dans une autre section (drag & drop)
  const moveToSection = async (taskId: string, sectionKey: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const current = sectionOf(getSection(t));
    if (current === sectionKey) return;
    const newTags = [...withoutSection(t.tags), `section:${sectionKey}`];
    setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, tags: newTags } : x)));
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").update({ tags: newTags }).eq("id", taskId);
      if (error) { toast.error(error.message); load(); return; }
      const def = SECTION_DEFS.find((d) => d.key === sectionKey);
      toast.success(`Déplacée vers ${def?.emoji ?? ""} ${def?.label ?? sectionKey}`);
      requestAutoSync();
    } else {
      await enqueue({ entity_type: "task", entity_id: taskId, action: "update", payload: { tags: newTags } });
    }
  };

  // Overrides pour les labels de section (édition inline persistée localement)
  const SECTION_LABELS_KEY = "plan-op-section-labels-v1";
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem(SECTION_LABELS_KEY) ?? "{}"); }
    catch { return {}; }
  });
  const renameSection = (key: string, label: string) => {
    setSectionLabels((prev) => {
      const next = { ...prev, [key]: label };
      try { window.localStorage.setItem(SECTION_LABELS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Création rapide d'une tâche dans une section donnée
  const createInSection = async (sectionKey: string) => {
    if (!user) return;
    const title = window.prompt("Titre de la nouvelle tâche ?");
    if (!title || !title.trim()) return;
    const sectionTag = `section:${sectionKey}`;
    const today = new Date();
    const due = new Date(today); due.setDate(due.getDate() + 7);
    const payload = {
      user_id: user.id,
      title: title.trim(),
      priority: "medium" as TaskPriority,
      status: "todo" as TaskStatus,
      source_app: "myhubpro" as TaskSource,
      tags: [sectionTag],
      gantt_start: today.toISOString(),
      gantt_end: due.toISOString(),
      due_date: due.toISOString(),
      attachments: [],
    };
    if (navigator.onLine) {
      const { data, error } = await supabase.from("tasks").insert(payload).select().single();
      if (error) { toast.error(error.message); return; }
      if (data) setTasks((prev) => [data as Task, ...prev]);
      toast.success("Tâche créée");
      requestAutoSync();
    } else {
      toast.error("Hors-ligne — réessaie plus tard");
    }
  };

  // Création rapide d'un thème / sous-thème du Plan d'opération (table op_plan_themes / op_plan_subthemes)
  const createOpTheme = async () => {
    if (!user) return;
    const name = window.prompt("Nom du nouveau thème ?")?.trim();
    if (!name) return;
    const { data: existing } = await supabase
      .from("op_plan_themes")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    const position = existing && existing.length ? (existing[0].position as number) + 1 : 0;
    const { data: ins, error } = await supabase
      .from("op_plan_themes")
      .insert({ user_id: user.id, name, position })
      .select("id,name,position")
      .single();
    if (error) { toast.error(error.message); return; }
    if (ins) setOpThemes((p) => [...p, ins as typeof opThemes[number]]);
    toast.success(`Thème « ${name} » créé`);
  };

  const createOpSubtheme = async () => {
    if (!user) return;
    if (!opThemes.length) {
      toast.error("Crée d'abord un thème");
      return;
    }
    const themes = opThemes;
    const list = themes.map((t, i) => `${i + 1}. ${t.name}`).join("\n");
    const pick = window.prompt(`Sous quel thème ?\n${list}\n\nEntre le numéro :`)?.trim();
    const idx = pick ? parseInt(pick, 10) - 1 : -1;
    if (Number.isNaN(idx) || idx < 0 || idx >= themes.length) return;
    const theme = themes[idx];
    const name = window.prompt(`Nom du nouveau sous-thème dans « ${theme.name} » ?`)?.trim();
    if (!name) return;
    const { data: existingSubs } = await supabase
      .from("op_plan_subthemes")
      .select("position")
      .eq("theme_id", theme.id)
      .order("position", { ascending: false })
      .limit(1);
    const position = existingSubs && existingSubs.length ? (existingSubs[0].position as number) + 1 : 0;
    const { data: ins, error } = await supabase
      .from("op_plan_subthemes")
      .insert({ user_id: user.id, theme_id: theme.id, name, position, items: [] })
      .select("id,name,theme_id,position")
      .single();
    if (error) { toast.error(error.message); return; }
    if (ins) setOpSubthemes((p) => [...p, ins as typeof opSubthemes[number]]);
    toast.success(`Sous-thème « ${name} » créé sous « ${theme.name} »`);
  };

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
    const [t, th, sub] = await Promise.all([
      supabase.from("tasks").select("*").neq("status", "archived"),
      supabase.from("op_plan_themes").select("id,name,position,show_in_plan").order("position"),
      supabase.from("op_plan_subthemes").select("id,name,theme_id,position,show_in_plan").order("position"),
    ]);
    if (t.error && !cTasks.length) toast.error(t.error.message);
    if (t.data) {
      setTasks(t.data as Task[]);
      cacheReplaceAll("tasks", t.data as Task[]).catch(() => {});
    }
    if (th.data) setOpThemes(th.data as typeof opThemes);
    if (sub.data) setOpSubthemes(sub.data as typeof opSubthemes);
    setLoading(false);
  };
  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => {
    const onOnline = () => { if (user) load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  // Rafraîchit dès qu'une tâche est créée/modifiée/supprimée ailleurs dans l'app
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`plan-op-tasks-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Build bars (tasks only — événements/RDV gérés dans l'Agenda)
  // Propagation automatique : toute tâche apparaît dans le Plan d'opération
  // dès sa création. Si aucune date n'est définie, la tâche est positionnée
  // à la date du jour pour que l'utilisateur la retrouve immédiatement.
  const allBars = useMemo<Bar[]>(() => {
    const out: Bar[] = [];
    const today9 = new Date();
    today9.setHours(9, 0, 0, 0);
    tasks.forEach((t) => {
      const anyDate = t.gantt_start || t.gantt_end || t.due_date;
      const s = anyDate
        ? new Date(t.gantt_start ?? t.due_date ?? t.gantt_end!)
        : today9;
      const e = anyDate
        ? new Date(t.gantt_end ?? t.due_date ?? t.gantt_start!)
        : today9;
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
  }, [tasks, sectionOf]);

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

  // Header ticks — deux niveaux : major (ligne du haut) et minor (ligne du bas, plus dense)
  const { majorTicks, minorTicks } = useMemo(() => {
    const major: { x: number; label: string }[] = [];
    const minor: { x: number; label: string }[] = [];
    const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const x = i * dayPx;
      const day = d.getDate();
      const month = d.getMonth();
      const isFirstOfMonth = day === 1;
      const isFirstOfQuarter = isFirstOfMonth && month % 3 === 0;
      const isFirstOfYear = isFirstOfMonth && month === 0;

      if (zoom === "week") {
        // Major : début de mois ; Minor : chaque jour (jour + initiale)
        if (isFirstOfMonth) major.push({ x, label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) });
        const dow = ["D", "L", "M", "M", "J", "V", "S"][d.getDay()];
        minor.push({ x, label: `${dow}${day}` });
      } else if (zoom === "month") {
        // Major : début de mois ; Minor : chaque lundi (numéro du jour)
        if (isFirstOfMonth) major.push({ x, label: d.toLocaleDateString("fr-FR", { month: "long", year: "2-digit" }) });
        if (d.getDay() === 1) minor.push({ x, label: String(day) });
      } else if (zoom === "quarter") {
        // Major : trimestre ; Minor : nom de mois
        if (isFirstOfQuarter) major.push({ x, label: `T${Math.floor(month / 3) + 1} ${d.getFullYear()}` });
        if (isFirstOfMonth) minor.push({ x, label: MONTHS_SHORT[month] });
      } else {
        // year — Major : année ; Minor : trimestres
        if (isFirstOfYear) major.push({ x, label: String(d.getFullYear()) });
        if (isFirstOfQuarter) minor.push({ x, label: `T${Math.floor(month / 3) + 1}` });
      }
    }
    return { majorTicks: major, minorTicks: minor };
  }, [days, start, dayPx, zoom]);

  // Group by section — thèmes utilisateurs toujours visibles (même vides), sections legacy seulement si non vides
  const grouped = useMemo(() => {
    const m = new Map<string, Bar[]>();
    SECTION_DEFS.forEach((s) => m.set(s.key, []));
    bars.forEach((b) => { const arr = m.get(b.section); if (arr) arr.push(b); else m.get("Autres")!.push(b); });
    return Array.from(m.entries()).filter(([key, v]) => {
      if (v.length > 0) return true;
      const def = SECTION_DEFS.find((d) => d.key === key);
      return !!def?.alwaysShow;
    });
  }, [bars, SECTION_DEFS]);

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

  const tryOpenBar = (b: Bar) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === b.id && now - last.ts < 400) {
      lastClickRef.current = null;
      handleBarClick(b);
    } else {
      lastClickRef.current = { id: b.id, ts: now };
    }
  };

  const handleUpdateRange = async (b: Bar, s: Date, e: Date) => {
    if (b.type !== "task") return;
    const payload = { gantt_start: s.toISOString(), gantt_end: e.toISOString(), due_date: e.toISOString() };
    setTasks((prev) => prev.map((t) => (t.id === b.id ? { ...t, ...payload } : t)));
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", b.id);
      if (error) toast.error(error.message);
      else requestAutoSync();
    } else {
      await enqueue({ entity_type: "task", entity_id: b.id, action: "update", payload });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setToDelete(null);
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) { toast.error(error.message); load(); return; }
      toast.success("Tâche supprimée");
      requestAutoSync();
    } else {
      await enqueue({ entity_type: "task", entity_id: id, action: "delete" });
      toast.success("Suppression mise en file (offline)");
    }
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
                  {["myhubpro","microsoft_todo","apple_reminders"].map((s) => (
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

          <Button variant="outline" size="sm" onClick={createOpTheme} className="gap-1" title="Créer un nouveau thème">
            + Thème
          </Button>
          <Button variant="outline" size="sm" onClick={createOpSubtheme} className="gap-1" title="Créer un nouveau sous-thème">
            + Sous-thème
          </Button>
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
        <>
          {/* ----- Vue MOBILE & TABLETTE (<1024px) : mini-carte + détail synchronisés ----- */}
          <div className="lg:hidden">
            <MobilePlanView
              bars={bars as unknown as MobileBar[]}
              sections={SECTION_DEFS.map((s) => ({ key: s.key, label: s.label, emoji: s.emoji }))}
              sectionLabels={sectionLabels}
              onRenameSection={renameSection}
              onOpenTask={(t) => { setEditing(t); setPanelOpen(true); }}
              onDeleteTask={(t) => setToDelete(t)}
              onUpdateRange={(t, s, e) => handleUpdateRange({ id: t.id, type: "task" } as Bar, s, e)}
              onCreateInSection={createInSection}
            />
          </div>

          {/* ----- Vue DESKTOP (≥1024px) : Gantt complet inchangé ----- */}
          <div className="hidden lg:block">
        <div ref={exportRef} className="rounded-xl border bg-card">
          <div ref={timelineRef} className="flex max-h-[calc(100vh-22rem)] overflow-auto">
            {/* Left labels */}
            <div className="sticky left-0 z-20 shrink-0 border-r bg-card" style={{ width: LABEL_W }}>
              <div className="h-14 border-b bg-muted/30" />
              {grouped.map(([sectionKey, items]) => {
                const def = SECTION_DEFS.find((d) => d.key === sectionKey)!;
                const isCollapsed = collapsed[sectionKey];
                const isDropTarget = dragOverSection === sectionKey;
                const onDragOver = (e: React.DragEvent) => {
                  if (!dragTaskId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverSection !== sectionKey) setDragOverSection(sectionKey);
                };
                const onDragLeave = () => {
                  if (dragOverSection === sectionKey) setDragOverSection(null);
                };
                const onDrop = (e: React.DragEvent) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragTaskId;
                  setDragOverSection(null);
                  setDragTaskId(null);
                  if (id) moveToSection(id, sectionKey);
                };
                return (
                  <div
                    key={sectionKey}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className={cn(isDropTarget && "bg-primary/5 ring-1 ring-inset ring-primary/40")}
                  >
                    <button
                      onClick={() => setCollapsed((p) => ({ ...p, [sectionKey]: !p[sectionKey] }))}
                      className="flex w-full items-center gap-1 border-b border-border bg-muted px-3 text-left text-[11px] font-bold uppercase tracking-wider text-foreground shadow-sm hover:bg-muted/80"
                      style={{ height: SECTION_H }}
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span>{def.emoji} {def.label}</span>
                      <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">{items.length}</Badge>
                    </button>
                    {!isCollapsed && items.map((b) => (
                      <ContextMenu key={b.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            draggable
                            onDragStart={(e) => {
                              setDragTaskId(b.id);
                              e.dataTransfer.setData("text/plain", b.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => { setDragTaskId(null); setDragOverSection(null); }}
                            onClick={() => tryOpenBar(b)}
                            className={cn(
                              "group flex cursor-grab items-center gap-2 border-b px-3 text-xs hover:bg-accent/50 active:cursor-grabbing",
                              dragTaskId === b.id && "opacity-40",
                              b.status === "done" && "bg-emerald-50/60",
                            )}
                            style={{ height: ROW_H }}
                            title={`${b.title} — double-cliquer pour ouvrir, glisser pour changer de section`}
                          >
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", b.priority ? PRIORITY_META[b.priority].dot : "bg-muted-foreground")} />
                            <span className="flex-1 truncate">{b.title}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setToDelete(b.raw as Task); }}
                              className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                              aria-label="Supprimer"
                              title="Supprimer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleBarClick(b)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Ouvrir / Modifier
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          {SECTION_DEFS.filter((d) => d.key !== sectionKey).map((d) => (
                            <ContextMenuItem key={d.key} onClick={() => moveToSection(b.id, d.key)}>
                              Déplacer vers {d.emoji} {d.label}
                            </ContextMenuItem>
                          ))}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => setToDelete(b.raw as Task)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Supprimer
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Timeline */}
            <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
              <div className="sticky top-0 z-10 h-14 border-b bg-card">
                {/* Ligne du haut : repères majeurs */}
                <div className="relative h-7 border-b">
                  {majorTicks.map((t, i) => (
                    <div key={`M${i}`} className="absolute top-0 h-full border-l border-foreground/30" style={{ left: t.x }}>
                      <span className="ml-1 mt-0.5 inline-block whitespace-nowrap text-[11px] font-semibold text-foreground">{t.label}</span>
                    </div>
                  ))}
                </div>
                {/* Ligne du bas : repères fins (jours / semaines / mois / trimestres selon le zoom) */}
                <div className="relative h-7">
                  {minorTicks.map((t, i) => (
                    <div key={`m${i}`} className="absolute top-0 h-full border-l border-border" style={{ left: t.x }}>
                      <span className="ml-0.5 mt-0.5 inline-block whitespace-nowrap text-[9px] text-muted-foreground">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Today line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div className="pointer-events-none absolute top-14 z-20 bottom-0 border-l-2 border-red-500" style={{ left: todayX }}>
                  <span className="absolute -left-5 -top-3 rounded bg-red-500 px-1 text-[9px] font-bold text-white">AUJ.</span>
                </div>
              )}

              {/* Overdue zone overlay per row drawn inside rows */}
              <div>
                {grouped.map(([sectionKey, items]) => {
                  const isCollapsed = collapsed[sectionKey];
                  return (
                    <div key={sectionKey}>
                      <div className="border-b border-border bg-muted" style={{ height: SECTION_H }} />
                      {!isCollapsed && items.map((b) => (
                        <BarRow key={b.id} bar={b} rowHeight={ROW_H} dayPx={dayPx} start={start} today={today}
                          onClick={() => handleBarClick(b)}
                          onDelete={() => setToDelete(b.raw as Task)}
                          onUpdateRange={(s, e) => handleUpdateRange(b, s, e)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
          </div>
        </>
      )}

      <TaskPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        task={editing}
        sections={[]}
        onSaved={(saved) => { setTasks((prev) => { const i = prev.findIndex((t) => t.id === saved.id); if (i >= 0) { const n = [...prev]; n[i] = saved; return n; } return [saved, ...prev]; }); }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette tâche ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toDelete?.title} » sera définitivement supprimée. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-500 hover:bg-red-600">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BarRow({
  bar, rowHeight, dayPx, start, today, onClick, onDelete, onUpdateRange,
}: {
  bar: Bar;
  rowHeight: number;
  dayPx: number;
  start: Date;
  today: Date;
  onClick: () => void;
  onDelete: () => void;
  onUpdateRange: (s: Date, e: Date) => void;
}) {
  const [drag, setDrag] = useState<null | { mode: "move" | "resize-l" | "resize-r"; startX: number; origStart: Date; origEnd: Date }>(null);
  const [preview, setPreview] = useState<{ s: Date; e: Date } | null>(null);
  const barClickRef = useRef<{ ts: number } | null>(null);

  const cur = preview ?? { s: bar.start, e: bar.end };
  const left = Math.floor((cur.s.getTime() - start.getTime()) / 86400000) * dayPx;
  const days = Math.max(1, Math.ceil((cur.e.getTime() - cur.s.getTime()) / 86400000) + 1);
  const width = Math.max(dayPx, days * dayPx);

  const isOverdue = bar.end < today && bar.status !== "done";
  const isDone = bar.status === "done";

  const urgencyColor = !isDone ? urgencyBarClass(bar.end, today) : null;
  const barColor = urgencyColor ?? (bar.priority ? PRIORITY_META[bar.priority].bar : "bg-muted-foreground");

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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <HoverCard openDelay={250} closeDelay={100}>
            <HoverCardTrigger asChild>
              <div
                onClick={(ev) => { if (!drag) { ev.stopPropagation(); onClick(); } }}
                onPointerDown={onPointerDown("move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={cn(
                  "group absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded px-2 text-[10px] font-medium shadow-sm cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md hover:ring-2",
                  isDone
                    ? "bg-emerald-200 text-emerald-900 hover:ring-emerald-400/50"
                    : `${barColor} text-white hover:ring-foreground/20`,
                  isOverdue && "ring-1 ring-red-600",
                )}
                style={{ left, width }}
              >
                <span onPointerDown={onPointerDown("resize-l")} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" />
                <span className="truncate">{bar.title}</span>
                <span onPointerDown={onPointerDown("resize-r")} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
              </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 p-3" side="top" align="start">
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", bar.priority ? PRIORITY_META[bar.priority].dot : "bg-muted-foreground")} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold leading-snug">{bar.title}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {cur.s.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} → {cur.e.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {bar.priority && (
                    <Badge variant="secondary" className="text-[10px]">{PRIORITY_META[bar.priority].emoji} {PRIORITY_META[bar.priority].label}</Badge>
                  )}
                  {bar.status && <Badge variant="outline" className="text-[10px]">{bar.status}</Badge>}
                  {isOverdue && <Badge variant="destructive" className="text-[10px]">En retard</Badge>}
                  {(bar.tags ?? []).filter((t) => !t.startsWith("section:")).slice(0, 4).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>
                  ))}
                </div>
                {bar.raw.description && (
                  <p className="line-clamp-3 text-xs text-muted-foreground">{bar.raw.description}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="default" className="h-7 flex-1 gap-1 text-xs" onClick={onClick}>
                    <ExternalLink className="h-3 w-3" /> Ouvrir
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-red-600 hover:text-red-700" onClick={onDelete}>
                    <Trash2 className="h-3 w-3" /> Supprimer
                  </Button>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onClick}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Ouvrir / Modifier
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-red-600 focus:text-red-600" onClick={onDelete}>
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Supprimer
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

