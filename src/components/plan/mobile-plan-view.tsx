import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronDown, ChevronRight, Pencil, Trash2, ExternalLink,
  Plus, Check, X, MoveHorizontal,
} from "lucide-react";
import { PRIORITY_META, type Task, type TaskPriority, type TaskStatus } from "@/lib/tasks-model";

export type MobileBar = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  section: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  raw: Task;
};

type Props = {
  bars: MobileBar[];
  sections: { key: string; label: string; emoji: string }[];
  /** Overrides for section labels (key -> custom label) */
  sectionLabels: Record<string, string>;
  onRenameSection: (key: string, label: string) => void;
  onOpenTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onUpdateRange: (task: Task, start: Date, end: Date) => void;
  onCreateInSection: (sectionKey: string) => void;
};

/**
 * MobilePlanView — affiche une mini-carte 3–6 mois compressée + une fenêtre
 * déplaçable qui pilote la vue détaillée scrollable (H et V) en dessous.
 */
export function MobilePlanView({
  bars, sections, sectionLabels,
  onRenameSection, onOpenTask, onDeleteTask, onUpdateRange, onCreateInSection,
}: Props) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  // Range globale : 3 ou 6 mois autour d'aujourd'hui, étendu si tâches dépassent
  const [span, setSpan] = useState<3 | 6>(3);
  const { rangeStart, rangeDays } = useMemo(() => {
    const half = Math.floor((span * 30) / 2);
    let min = new Date(today); min.setDate(min.getDate() - 14);
    let max = new Date(today); max.setDate(max.getDate() + half * 2);
    bars.forEach((b) => {
      if (b.start < min) min = new Date(b.start);
      if (b.end > max) max = new Date(b.end);
    });
    min.setHours(0,0,0,0); max.setHours(0,0,0,0);
    const totalDays = Math.ceil((max.getTime() - min.getTime()) / 86400000) + 1;
    return { rangeStart: min, rangeDays: totalDays };
  }, [bars, today, span]);

  // Mini-carte dimensions
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniW, setMiniW] = useState(360);
  useEffect(() => {
    if (!miniRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setMiniW(e.contentRect.width);
    });
    ro.observe(miniRef.current);
    return () => ro.disconnect();
  }, []);
  const miniDayPx = miniW / Math.max(1, rangeDays);

  // Groupes
  const grouped = useMemo(() => {
    const m = new Map<string, MobileBar[]>();
    sections.forEach((s) => m.set(s.key, []));
    bars.forEach((b) => { m.get(b.section)?.push(b); });
    return Array.from(m.entries()).filter(([, v]) => v.length > 0);
  }, [bars, sections]);

  // Fenêtre de zoom (en jours) → contrôle la vue détaillée
  const initialWindowDays = Math.min(rangeDays, span === 3 ? 21 : 30);
  const [winStartIdx, setWinStartIdx] = useState(() => {
    const todayIdx = Math.floor((today.getTime() - rangeStart.getTime()) / 86400000);
    return Math.max(0, Math.min(rangeDays - initialWindowDays, todayIdx - Math.floor(initialWindowDays / 3)));
  });
  const [winDays, setWinDays] = useState(initialWindowDays);

  // Reset window when range changes
  useEffect(() => {
    const newWin = Math.min(rangeDays, span === 3 ? 21 : 30);
    setWinDays(newWin);
    const todayIdx = Math.floor((today.getTime() - rangeStart.getTime()) / 86400000);
    setWinStartIdx(Math.max(0, Math.min(rangeDays - newWin, todayIdx - Math.floor(newWin / 3))));
    // eslint-disable-next-line
  }, [rangeStart.getTime(), rangeDays, span]);

  // Drag de la fenêtre sur la mini-carte
  const dragRef = useRef<null | { startX: number; origIdx: number; mode: "move" | "left" | "right"; origDays: number }>(null);
  const onWinPointerDown = (mode: "move" | "left" | "right") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    dragRef.current = { startX: ev.clientX, origIdx: winStartIdx, mode, origDays: winDays };
  };
  const onWinPointerMove = (ev: React.PointerEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const ddx = Math.round((ev.clientX - d.startX) / miniDayPx);
    if (d.mode === "move") {
      setWinStartIdx(Math.max(0, Math.min(rangeDays - winDays, d.origIdx + ddx)));
    } else if (d.mode === "left") {
      const newStart = Math.max(0, Math.min(d.origIdx + d.origDays - 3, d.origIdx + ddx));
      const newDays = d.origDays + (d.origIdx - newStart);
      setWinStartIdx(newStart);
      setWinDays(Math.max(3, newDays));
    } else {
      const newDays = Math.max(3, Math.min(rangeDays - d.origIdx, d.origDays + ddx));
      setWinDays(newDays);
    }
  };
  const onWinPointerUp = () => { dragRef.current = null; };

  // Tap sur la mini-carte pour déplacer la fenêtre
  const onMiniTap = (ev: React.PointerEvent) => {
    if (dragRef.current) return;
    const rect = (ev.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const idx = Math.floor(x / miniDayPx) - Math.floor(winDays / 2);
    setWinStartIdx(Math.max(0, Math.min(rangeDays - winDays, idx)));
  };

  // Vue détaillée : convertit la fenêtre en pixels (≈ 36px/jour)
  const detailDayPx = 36;
  const detailWidth = winDays * detailDayPx;
  const detailStart = useMemo(() => {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + winStartIdx);
    return d;
  }, [rangeStart, winStartIdx]);

  const todayXmini = Math.floor((today.getTime() - rangeStart.getTime()) / 86400000) * miniDayPx;
  const todayXdetail = Math.floor((today.getTime() - detailStart.getTime()) / 86400000) * detailDayPx;

  // Ticks détaillés : un par semaine (lundi) + mois
  const detailTicks = useMemo(() => {
    const out: { x: number; label: string; major: boolean }[] = [];
    for (let i = 0; i < winDays; i++) {
      const d = new Date(detailStart); d.setDate(d.getDate() + i);
      if (d.getDate() === 1) {
        out.push({ x: i * detailDayPx, label: d.toLocaleDateString("fr-FR", { month: "short" }), major: true });
      } else if (d.getDay() === 1) {
        out.push({ x: i * detailDayPx, label: String(d.getDate()), major: false });
      }
    }
    return out;
  }, [winDays, detailStart]);

  // Action sheet (long-press sur barre)
  const [sheetBar, setSheetBar] = useState<MobileBar | null>(null);

  // Édition inline du nom de section
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Section collapse
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const ROW_H = 32;
  const SECTION_H = 36;

  // Window position on mini-map (in px)
  const winLeftPx = winStartIdx * miniDayPx;
  const winWidthPx = Math.max(20, winDays * miniDayPx);

  return (
    <div className="space-y-3">
      {/* --- BLOC HAUT : mini-carte d'ensemble --- */}
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Vue d'ensemble — glisse la fenêtre pour zoomer
          </div>
          <div className="inline-flex overflow-hidden rounded-md border text-[10px]">
            {([3, 6] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpan(s)}
                className={cn(
                  "px-2 py-0.5",
                  span === s ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {s} mois
              </button>
            ))}
          </div>
        </div>

        <div
          ref={miniRef}
          onPointerDown={onMiniTap}
          className="relative w-full select-none rounded-md bg-muted/40"
          style={{ height: Math.max(80, grouped.length * 10 + 16), touchAction: "none" }}
        >
          {/* Mois labels */}
          <div className="absolute inset-x-0 top-0 h-4 overflow-hidden">
            {Array.from({ length: rangeDays }, (_, i) => {
              const d = new Date(rangeStart); d.setDate(d.getDate() + i);
              if (d.getDate() !== 1) return null;
              return (
                <div
                  key={i}
                  className="absolute top-0 border-l border-foreground/15 pl-1 text-[8px] text-muted-foreground"
                  style={{ left: i * miniDayPx, height: "100%" }}
                >
                  {d.toLocaleDateString("fr-FR", { month: "short" })}
                </div>
              );
            })}
          </div>

          {/* Today line */}
          {todayXmini >= 0 && todayXmini <= miniW && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-red-500"
              style={{ left: todayXmini }}
            />
          )}

          {/* Barres compressées par section */}
          <div className="absolute inset-x-0 bottom-0 top-4">
            {grouped.map(([sectionKey, items], rowIdx) => (
              <div
                key={sectionKey}
                className="relative"
                style={{ height: 10, marginTop: rowIdx === 0 ? 0 : 1 }}
              >
                {items.map((b) => {
                  const x = Math.floor((b.start.getTime() - rangeStart.getTime()) / 86400000) * miniDayPx;
                  const w = Math.max(2, Math.ceil((b.end.getTime() - b.start.getTime()) / 86400000 + 1) * miniDayPx);
                  return (
                    <div
                      key={b.id}
                      className={cn(
                        "absolute top-1 h-2 rounded-sm opacity-80",
                        b.status === "done"
                          ? "bg-emerald-300"
                          : b.priority
                            ? PRIORITY_META[b.priority].bar
                            : "bg-muted-foreground",
                      )}
                      style={{ left: x, width: w }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Fenêtre de zoom */}
          <div
            className="absolute top-0 bottom-0 border-2 border-primary bg-primary/15 rounded"
            style={{ left: winLeftPx, width: winWidthPx, touchAction: "none" }}
            onPointerDown={onWinPointerDown("move")}
            onPointerMove={onWinPointerMove}
            onPointerUp={onWinPointerUp}
            onPointerCancel={onWinPointerUp}
          >
            <div
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-primary/70"
              onPointerDown={onWinPointerDown("left")}
            />
            <div
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary/70"
              onPointerDown={onWinPointerDown("right")}
            />
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center">
              <MoveHorizontal className="h-3 w-3 text-primary/70" />
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{detailStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
          <span>{winDays} jours visibles</span>
          <span>
            {(() => {
              const e = new Date(detailStart); e.setDate(e.getDate() + winDays - 1);
              return e.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
            })()}
          </span>
        </div>
      </div>

      {/* --- BLOC BAS : vue détaillée synchronisée --- */}
      <div className="rounded-xl border bg-card">
        <div
          className="relative overflow-auto"
          style={{
            maxHeight: "calc(100vh - 28rem)",
            minHeight: 280,
            touchAction: "pan-x pan-y",
            overscrollBehavior: "contain",
          }}
        >
          <div className="relative" style={{ width: detailWidth, minWidth: "100%" }}>
            {/* Header sticky */}
            <div className="sticky top-0 z-20 h-8 border-b bg-card">
              {detailTicks.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "absolute top-0 h-full border-l text-[10px]",
                    t.major ? "border-foreground/30 font-semibold" : "border-border",
                  )}
                  style={{ left: t.x }}
                >
                  <span className="ml-0.5 text-muted-foreground">{t.label}</span>
                </div>
              ))}
              {todayXdetail >= 0 && todayXdetail <= detailWidth && (
                <div
                  className="pointer-events-none absolute top-0 h-full border-l-2 border-red-500"
                  style={{ left: todayXdetail }}
                >
                  <span className="absolute -top-0 left-0.5 rounded bg-red-500 px-1 text-[8px] font-bold text-white">
                    AUJ.
                  </span>
                </div>
              )}
            </div>

            {/* Today line full height */}
            {todayXdetail >= 0 && todayXdetail <= detailWidth && (
              <div
                className="pointer-events-none absolute top-8 bottom-0 z-10 border-l border-red-500/60"
                style={{ left: todayXdetail }}
              />
            )}

            {/* Sections */}
            {grouped.map(([sectionKey, items]) => {
              const def = sections.find((s) => s.key === sectionKey);
              if (!def) return null;
              const label = sectionLabels[sectionKey] ?? def.label;
              const isCollapsed = collapsed[sectionKey];
              const isEditing = editingSection === sectionKey;
              return (
                <div key={sectionKey}>
                  <div
                    className="sticky left-0 z-10 flex items-center gap-1 border-b bg-muted/60 px-2 backdrop-blur"
                    style={{ height: SECTION_H, width: "100vw", maxWidth: "100%" }}
                  >
                    <button
                      onClick={() => setCollapsed((p) => ({ ...p, [sectionKey]: !p[sectionKey] }))}
                      className="text-muted-foreground"
                      aria-label="Toggle"
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <span className="text-base">{def.emoji}</span>
                    {isEditing ? (
                      <>
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                          className="h-7 flex-1 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              onRenameSection(sectionKey, editValue.trim() || def.label);
                              setEditingSection(null);
                            }
                            if (e.key === "Escape") setEditingSection(null);
                          }}
                        />
                        <button
                          onClick={() => {
                            onRenameSection(sectionKey, editValue.trim() || def.label);
                            setEditingSection(null);
                          }}
                          className="text-emerald-600"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditingSection(null)} className="text-muted-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="flex-1 truncate text-xs font-semibold uppercase tracking-wider text-foreground/80"
                          onPointerDown={(e) => {
                            // long-press = renommer
                            const timer = setTimeout(() => {
                              setEditValue(label);
                              setEditingSection(sectionKey);
                            }, 500);
                            const cancel = () => clearTimeout(timer);
                            e.currentTarget.addEventListener("pointerup", cancel, { once: true });
                            e.currentTarget.addEventListener("pointercancel", cancel, { once: true });
                            e.currentTarget.addEventListener("pointermove", cancel, { once: true });
                          }}
                        >
                          {label}
                        </span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {items.length}
                        </Badge>
                        <button
                          onClick={() => {
                            setEditValue(label);
                            setEditingSection(sectionKey);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Renommer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onCreateInSection(sectionKey)}
                          className="text-muted-foreground hover:text-primary"
                          aria-label="Ajouter une tâche"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>

                  {!isCollapsed && items.map((b) => (
                    <DetailRow
                      key={b.id}
                      bar={b}
                      rowHeight={ROW_H}
                      dayPx={detailDayPx}
                      detailStart={detailStart}
                      today={today}
                      onOpenLongPress={() => setSheetBar(b)}
                      onUpdateRange={(s, e) => onUpdateRange(b.raw, s, e)}
                    />
                  ))}
                </div>
              );
            })}

            {grouped.length === 0 && (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Aucune tâche dans cette plage
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action sheet sur long-press */}
      <Sheet open={!!sheetBar} onOpenChange={(o) => { if (!o) setSheetBar(null); }}>
        <SheetContent side="bottom" className="h-auto">
          {sheetBar && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-left">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      sheetBar.priority ? PRIORITY_META[sheetBar.priority].dot : "bg-muted-foreground",
                    )}
                  />
                  <span className="flex-1 truncate">{sheetBar.title}</span>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-2 text-xs text-muted-foreground">
                {sheetBar.start.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                {" → "}
                {sheetBar.end.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </div>
              {sheetBar.raw.description && (
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{sheetBar.raw.description}</p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="default"
                  className="gap-1"
                  onClick={() => { onOpenTask(sheetBar.raw); setSheetBar(null); }}
                >
                  <ExternalLink className="h-4 w-4" /> Ouvrir
                </Button>
                <Button
                  variant="outline"
                  className="gap-1 text-red-600 hover:text-red-700"
                  onClick={() => { onDeleteTask(sheetBar.raw); setSheetBar(null); }}
                >
                  <Trash2 className="h-4 w-4" /> Supprimer
                </Button>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Astuce : glisse la barre horizontalement pour la déplacer, ou utilise les poignées pour la redimensionner.
              </p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({
  bar, rowHeight, dayPx, detailStart, today, onOpenLongPress, onUpdateRange,
}: {
  bar: MobileBar;
  rowHeight: number;
  dayPx: number;
  detailStart: Date;
  today: Date;
  onOpenLongPress: () => void;
  onUpdateRange: (s: Date, e: Date) => void;
}) {
  const [drag, setDrag] = useState<null | { mode: "move" | "resize-l" | "resize-r"; startX: number; startY: number; origStart: Date; origEnd: Date; activated: boolean }>(null);
  const [preview, setPreview] = useState<{ s: Date; e: Date } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const cur = preview ?? { s: bar.start, e: bar.end };
  const left = Math.floor((cur.s.getTime() - detailStart.getTime()) / 86400000) * dayPx;
  const widthDays = Math.max(1, Math.ceil((cur.e.getTime() - cur.s.getTime()) / 86400000) + 1);
  const width = Math.max(dayPx, widthDays * dayPx);

  const isOverdue = bar.end < today && bar.status !== "done";
  const isDone = bar.status === "done";
  const barColor = isDone ? "bg-emerald-200" : bar.priority ? PRIORITY_META[bar.priority].bar : "bg-muted-foreground";

  const startDrag = (mode: "move" | "resize-l" | "resize-r") => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({
      mode, startX: ev.clientX, startY: ev.clientY,
      origStart: bar.start, origEnd: bar.end,
      activated: mode !== "move", // les poignées activent immédiatement
    });
    if (mode === "move") {
      // long-press déclenche l'action sheet si pas de mouvement
      longPressTimer.current = window.setTimeout(() => {
        if (drag === null || !drag?.activated) {
          onOpenLongPress();
        }
      }, 500);
    }
  };

  const onMove = (ev: React.PointerEvent) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    // Activer le drag de déplacement uniquement après ≥10px en X
    if (drag.mode === "move" && !drag.activated) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        setDrag({ ...drag, activated: true });
      } else if (Math.abs(dy) > 8) {
        // mouvement vertical = scroll, on annule
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        setDrag(null);
        return;
      } else {
        return;
      }
    }
    const dDays = Math.round(dx / dayPx);
    if (dDays === 0) { setPreview(null); return; }
    let ns = new Date(drag.origStart), ne = new Date(drag.origEnd);
    if (drag.mode === "move") { ns.setDate(ns.getDate() + dDays); ne.setDate(ne.getDate() + dDays); }
    if (drag.mode === "resize-l") { ns.setDate(ns.getDate() + dDays); if (ns > ne) ns = new Date(ne); }
    if (drag.mode === "resize-r") { ne.setDate(ne.getDate() + dDays); if (ne < ns) ne = new Date(ns); }
    setPreview({ s: ns, e: ne });
  };

  const onUp = (ev: React.PointerEvent) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (drag) {
      if (drag.activated && preview) {
        onUpdateRange(preview.s, preview.e);
      } else if (drag.mode === "move" && !preview) {
        // tap court = ouvrir
        const dx = Math.abs(ev.clientX - drag.startX);
        const dy = Math.abs(ev.clientY - drag.startY);
        if (dx < 6 && dy < 6) onOpenLongPress();
      }
    }
    setDrag(null);
    setPreview(null);
  };

  const onCancel = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    setDrag(null);
    setPreview(null);
  };

  return (
    <div className="relative border-b" style={{ height: rowHeight }}>
      <div
        onPointerDown={startDrag("move")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        className={cn(
          "absolute top-1/2 flex h-6 -translate-y-1/2 items-center rounded px-2 text-[10px] font-medium text-white shadow-sm",
          barColor,
          isDone && "opacity-60",
          isOverdue && "ring-1 ring-red-600",
        )}
        style={{ left, width, touchAction: "none" }}
      >
        <span
          onPointerDown={startDrag("resize-l")}
          className="absolute left-0 top-0 h-full w-3"
          style={{ touchAction: "none" }}
        />
        <span className="truncate">{bar.title}</span>
        <span
          onPointerDown={startDrag("resize-r")}
          className="absolute right-0 top-0 h-full w-3"
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
}
