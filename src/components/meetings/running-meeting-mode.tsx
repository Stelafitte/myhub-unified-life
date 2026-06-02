import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { X, SkipForward, AlertTriangle, CheckCircle2, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgendaItem } from "./agenda-section";

function formatTime(secs: number): string {
  const sign = secs < 0 ? "-" : "";
  const s = Math.abs(secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${sign}${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function RunningMeetingMode({
  meetingTitle,
  items,
  onClose,
  onItemStatusChange,
}: {
  meetingTitle: string;
  items: AgendaItem[];
  onClose: () => void;
  onItemStatusChange: (id: string, status: AgendaItem["status"]) => void;
}) {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const [activeIdx, setActiveIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds on current item
  const [paused, setPaused] = useState(false);

  const active = ordered[activeIdx];
  const totalSec = (active?.duration_minutes ?? 0) * 60;
  const remaining = totalSec - elapsed;
  const overtime = remaining < 0;

  useEffect(() => {
    if (paused || !active) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [paused, active]);

  useEffect(() => {
    // Mark active as in_progress on switch
    if (active && active.status !== "in_progress" && active.status !== "done") {
      onItemStatusChange(active.id, "in_progress");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  function next() {
    if (!active) return;
    onItemStatusChange(active.id, "done");
    if (activeIdx < ordered.length - 1) {
      setActiveIdx((i) => i + 1);
      setElapsed(0);
    } else {
      onClose();
    }
  }

  if (!active) return null;
  const progressPct = Math.min(100, totalSec > 0 ? (elapsed / totalSec) * 100 : 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-3xl h-[85vh] flex flex-col p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground truncate">
              Réunion en cours · {meetingTitle}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_280px] gap-0">
          {/* Active point */}
          <div className="p-6 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
            <Badge variant="secondary" className="text-xs">
              Point {activeIdx + 1} / {ordered.length}
            </Badge>
            <h2 className="text-2xl font-semibold">{active.title}</h2>
            {active.responsible_name || active.responsible_email ? (
              <p className="text-sm text-muted-foreground">
                Responsable : {active.responsible_name || active.responsible_email}
              </p>
            ) : null}

            <div
              className={cn(
                "text-7xl font-mono font-bold tabular-nums",
                overtime ? "text-destructive" : "text-foreground",
              )}
            >
              {formatTime(remaining)}
            </div>
            <Progress value={progressPct} className="w-full max-w-md" />
            <p className="text-xs text-muted-foreground">
              Durée prévue : {active.duration_minutes} min
            </p>

            {overtime && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Dépassement du temps prévu
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
                {paused ? (
                  <>
                    <Play className="h-4 w-4 mr-1" /> Reprendre
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 mr-1" /> Pause
                  </>
                )}
              </Button>
              <Button size="sm" onClick={next}>
                <SkipForward className="h-4 w-4 mr-1" />
                {activeIdx === ordered.length - 1 ? "Terminer" : "Point suivant"}
              </Button>
            </div>
          </div>

          {/* Sidebar */}
          <div className="border-l overflow-y-auto bg-muted/20">
            <div className="p-3 text-xs font-medium text-muted-foreground border-b">
              Ordre du jour
            </div>
            <ul className="p-2 space-y-1">
              {ordered.map((it, idx) => (
                <li
                  key={it.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md p-2 text-sm cursor-pointer hover:bg-muted",
                    idx === activeIdx && "bg-primary/10 ring-1 ring-primary",
                  )}
                  onClick={() => {
                    setActiveIdx(idx);
                    setElapsed(0);
                  }}
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                  <span className="flex-1 truncate">{it.title}</span>
                  {it.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {it.duration_minutes}m
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
