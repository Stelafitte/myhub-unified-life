import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Task, PRIORITY_META, getSection } from "@/lib/tasks-model";

type Props = {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onUpdateRange: (task: Task, start: Date, end: Date) => void;
};

type Zoom = "day" | "week" | "month";

const ZOOM_PX: Record<Zoom, number> = { day: 48, week: 18, month: 6 };

export function GanttView({ tasks, onEdit, onUpdateRange }: Props) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const containerRef = useRef<HTMLDivElement>(null);
  const dayPx = ZOOM_PX[zoom];

  // Determine date range
  const { start, end, days, today } = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let min = new Date(now); min.setDate(min.getDate() - 7);
    let max = new Date(now); max.setDate(max.getDate() + 30);
    tasks.forEach((t) => {
      const s = t.gantt_start ? new Date(t.gantt_start) : null;
      const e = t.gantt_end ? new Date(t.gantt_end) : (t.due_date ? new Date(t.due_date) : null);
      if (s && s < min) min = new Date(s);
      if (e && e > max) max = new Date(e);
    });
    const totalDays = Math.ceil((max.getTime() - min.getTime()) / 86400000) + 1;
    return { start: min, end: max, days: totalDays, today: now };
  }, [tasks]);

  // Group by section
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const s = getSection(t);
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(t);
    });
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  const dateToX = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 86400000) * dayPx;
  const todayX = dateToX(today);

  // Header ticks
  const ticks = useMemo(() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const isFirst = d.getDate() === 1;
      if (zoom === "day") {
        out.push({ x: i * dayPx, label: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }), major: isFirst });
      } else if (zoom === "week" && d.getDay() === 1) {
        out.push({ x: i * dayPx, label: `S${weekNum(d)}`, major: isFirst });
      } else if (zoom === "month" && isFirst) {
        out.push({ x: i * dayPx, label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), major: true });
      }
    }
    return out;
  }, [days, dayPx, start, zoom]);

  const totalWidth = days * dayPx;
  const ROW_H = 32;
  const LABEL_W = 200;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {start.toLocaleDateString("fr-FR")} → {end.toLocaleDateString("fr-FR")} · {tasks.length} tâche{tasks.length > 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={zoom === "day" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setZoom("day")}>Jour</Button>
          <Button size="sm" variant={zoom === "week" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setZoom("week")}>Semaine</Button>
          <Button size="sm" variant={zoom === "month" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setZoom("month")}>Mois</Button>
        </div>
      </div>

      <div ref={containerRef} className="flex max-h-[calc(100vh-14rem)] overflow-auto">
        {/* Left labels */}
        <div className="sticky left-0 z-10 shrink-0 border-r bg-card" style={{ width: LABEL_W }}>
          <div className="h-10 border-b bg-muted/30" />
          {groups.map(([section, items]) => (
            <div key={section}>
              <div className="border-b bg-muted/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section}
              </div>
              {items.map((t) => (
                <div key={t.id} className="flex items-center border-b px-3 text-xs" style={{ height: ROW_H }}>
                  <span className="truncate">{t.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
          {/* Header */}
          <div className="sticky top-0 z-10 h-10 border-b bg-card">
            {ticks.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "absolute top-0 h-full border-l text-[10px]",
                  t.major ? "border-foreground/20 font-semibold" : "border-border",
                )}
                style={{ left: t.x }}
              >
                <span className="ml-1 mt-1 inline-block whitespace-nowrap text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>

          {/* Today line */}
          {todayX >= 0 && todayX <= totalWidth && (
            <div className="pointer-events-none absolute top-10 z-20 h-full border-l-2 border-red-500" style={{ left: todayX }}>
              <span className="absolute -left-4 -top-3 rounded bg-red-500 px-1 text-[9px] font-bold text-white">AUJ.</span>
            </div>
          )}

          {/* Rows */}
          <div>
            {groups.map(([section, items]) => (
              <div key={section}>
                <div className="border-b bg-muted/20" style={{ height: 22 }} />
                {items.map((t) => (
                  <GanttRow
                    key={t.id}
                    task={t}
                    rowHeight={ROW_H}
                    dayPx={dayPx}
                    start={start}
                    onEdit={() => onEdit(t)}
                    onUpdateRange={(s, e) => onUpdateRange(t, s, e)}
                  />
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">Aucune tâche à afficher</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttRow({
  task, rowHeight, dayPx, start, onEdit, onUpdateRange,
}: {
  task: Task;
  rowHeight: number;
  dayPx: number;
  start: Date;
  onEdit: () => void;
  onUpdateRange: (s: Date, e: Date) => void;
}) {
  const s = task.gantt_start ? new Date(task.gantt_start) : (task.due_date ? new Date(task.due_date) : null);
  const e = task.gantt_end ? new Date(task.gantt_end) : (task.due_date ? new Date(task.due_date) : null);
  const meta = PRIORITY_META[task.priority];

  const [drag, setDrag] = useState<null | { mode: "move" | "resize-l" | "resize-r"; startX: number; origStart: Date; origEnd: Date }>(null);
  const [preview, setPreview] = useState<{ s: Date; e: Date } | null>(null);

  if (!s || !e) {
    // Show only milestone for due_date
    if (task.due_date) {
      const dx = Math.floor((new Date(task.due_date).getTime() - start.getTime()) / 86400000) * dayPx;
      return (
        <div className="relative border-b" style={{ height: rowHeight }}>
          <div
            title={task.title}
            onClick={onEdit}
            className={cn("absolute top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 cursor-pointer", meta.bar)}
            style={{ left: dx }}
          />
        </div>
      );
    }
    return <div className="border-b" style={{ height: rowHeight }} />;
  }

  const cur = preview ?? { s, e };
  const left = Math.floor((cur.s.getTime() - start.getTime()) / 86400000) * dayPx;
  const days = Math.max(1, Math.ceil((cur.e.getTime() - cur.s.getTime()) / 86400000) + 1);
  const width = days * dayPx;

  const onPointerDown = (mode: "move" | "resize-l" | "resize-r") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ mode, startX: ev.clientX, origStart: s, origEnd: e });
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
    setDrag(null);
    setPreview(null);
  };

  return (
    <div className="relative border-b" style={{ height: rowHeight }}>
      <div
        title={`${task.title} — ${cur.s.toLocaleDateString()} → ${cur.e.toLocaleDateString()}`}
        onClick={(ev) => { if (!drag) { ev.stopPropagation(); onEdit(); } }}
        onPointerDown={onPointerDown("move")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "group absolute top-1/2 flex h-5 -translate-y-1/2 cursor-grab items-center rounded px-2 text-[10px] font-medium text-white shadow-sm active:cursor-grabbing",
          meta.bar,
        )}
        style={{ left, width }}
      >
        <span
          onPointerDown={onPointerDown("resize-l")}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize"
        />
        <span className="truncate">{task.title}</span>
        <span
          onPointerDown={onPointerDown("resize-r")}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize"
        />
      </div>
    </div>
  );
}

function weekNum(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
