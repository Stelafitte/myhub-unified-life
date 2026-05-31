import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  SkipForward,
  Wand2,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  ListTodo,
  CalendarPlus,
  Mail,
  Bell,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import {
  proposeInsightAction,
  type ProposedAction,
} from "@/lib/api/insight-action.functions";

export type InsightItem = { kind: "suggestion" | "alert"; text: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
  items: InsightItem[];
  context?: { unreadCount?: number; overdueCount?: number; todayEvents?: number };
};

type Outcome = "applied" | "ignored" | "skipped";

export function InsightsProcessorDialog({ open, onOpenChange, userId, items, context }: Props) {
  const propose = useServerFn(proposeInsightAction);
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<ProposedAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ProposedAction | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});

  const total = items.length;
  const current = items[index];
  const done = index >= total;

  // Reset on open
  useEffect(() => {
    if (open) {
      setIndex(0);
      setAction(null);
      setEditing(false);
      setOutcomes({});
    }
  }, [open]);

  // Auto-propose on each item
  useEffect(() => {
    if (!open || done || !current) return;
    let cancelled = false;
    setAction(null);
    setEditing(false);
    setLoading(true);
    propose({ data: { text: current.text, kind: current.kind, context } })
      .then((res) => {
        if (cancelled) return;
        setAction(res);
        setEditForm(res);
      })
      .catch(() => {
        if (!cancelled) {
          setAction({ type: "none", reason: "Analyse IA indisponible." });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const advance = (outcome: Outcome) => {
    setOutcomes((o) => ({ ...o, [index]: outcome }));
    setIndex((i) => i + 1);
  };

  const applyAction = async (a: ProposedAction) => {
    if (!userId) {
      toast.error("Utilisateur non connecté");
      return;
    }
    try {
      switch (a.type) {
        case "create_task": {
          const due =
            a.due_in_hours != null
              ? new Date(Date.now() + a.due_in_hours * 3600 * 1000).toISOString()
              : null;
          const allowed = ["low", "medium", "high", "urgent"] as const;
          type Prio = (typeof allowed)[number];
          const priority: Prio = (allowed as readonly string[]).includes(a.priority)
            ? (a.priority as Prio)
            : "medium";
          const { error } = await supabase.from("tasks").insert({
            user_id: userId,
            title: a.title,
            status: "todo",
            priority,
            due_date: due,
          });
          if (error) throw new Error(error.message);
          toast.success("Tâche créée");
          requestAutoSync();
          break;
        }
        case "create_event": {
          const start = new Date(a.start_iso);
          const end = new Date(start.getTime() + (a.duration_min || 30) * 60000);
          const { error } = await supabase.from("calendar_events").insert({
            user_id: userId,
            title: a.title,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            source: null,
          });
          if (error) throw new Error(error.message);
          toast.success("Événement ajouté");
          requestAutoSync();
          break;
        }
        case "reminder": {
          const remind = new Date(Date.now() + a.remind_in_hours * 3600 * 1000).toISOString();
          const { error } = await supabase.from("tasks").insert({
            user_id: userId,
            title: a.title,
            status: "todo",
            priority: "medium",
            reminder_at: remind,
            due_date: remind,
          });
          if (error) throw new Error(error.message);
          toast.success("Rappel programmé");
          requestAutoSync();
          break;
        }
        case "open_inbox": {
          onOpenChange(false);
          navigate({ to: "/inbox" });
          return;
        }
        case "open_tasks": {
          onOpenChange(false);
          navigate({ to: "/tasks" });
          return;
        }
        case "none":
        default:
          toast.message("Aucune action exécutée");
          break;
      }
      advance("applied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const stats = useMemo(() => {
    const v = Object.values(outcomes);
    return {
      applied: v.filter((x) => x === "applied").length,
      ignored: v.filter((x) => x === "ignored").length,
      skipped: v.filter((x) => x === "skipped").length,
    };
  }, [outcomes]);

  const ActionIcon = action ? actionIcon(action.type) : Sparkles;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Traitement des insights IA
          </DialogTitle>
        </DialogHeader>

        {total === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Aucune suggestion ni alerte à traiter.
          </div>
        ) : done ? (
          <div className="space-y-4 py-4">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
              <div className="mt-3 text-lg font-medium">Traitement terminé</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {stats.applied} appliquée·s · {stats.ignored} ignorée·s · {stats.skipped} passée·s
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {index + 1} / {total}
                </span>
                <span>
                  ✓ {stats.applied} · ✕ {stats.ignored} · ↷ {stats.skipped}
                </span>
              </div>
              <Progress value={((index + (loading ? 0 : 0.5)) / total) * 100} />
            </div>

            {current && (
              <div className="rounded-md border bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  {current.kind === "alert" ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> Alerte
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Suggestion
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-snug">{current.text}</p>
              </div>
            )}

            <div className="rounded-md border bg-primary/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                <Wand2 className="h-3.5 w-3.5" /> Action proposée par l'IA
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Analyse en cours…
                </div>
              ) : action ? (
                editing && editForm ? (
                  <EditActionForm
                    action={editForm}
                    onChange={setEditForm}
                    onCancel={() => {
                      setEditing(false);
                      setEditForm(action);
                    }}
                    onSave={() => {
                      if (editForm) {
                        applyAction(editForm);
                        setEditing(false);
                      }
                    }}
                  />
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <ActionIcon className="h-4 w-4 text-primary" />
                      <span className="font-medium">{actionLabel(action)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{action.reason}</div>
                    <ActionSummary action={action} />
                  </div>
                )
              ) : null}
            </div>

            {!editing && (
              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => advance("skipped")}
                    disabled={loading}
                  >
                    <SkipForward className="mr-1 h-3.5 w-3.5" /> Passer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => advance("ignored")}
                    disabled={loading}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Ne pas traiter
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (action) setEditForm(action);
                      setEditing(true);
                    }}
                    disabled={loading || !action || action.type === "none"}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Corriger
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => action && applyAction(action)}
                    disabled={loading || !action || action.type === "none"}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Appliquer (auto IA)
                  </Button>
                </div>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function actionIcon(type: ProposedAction["type"]) {
  switch (type) {
    case "create_task":
      return ListTodo;
    case "create_event":
      return CalendarPlus;
    case "reminder":
      return Bell;
    case "open_inbox":
      return Inbox;
    case "open_tasks":
      return ListTodo;
    default:
      return Mail;
  }
}

function actionLabel(a: ProposedAction): string {
  switch (a.type) {
    case "create_task":
      return "Créer une tâche";
    case "create_event":
      return "Ajouter à l'agenda";
    case "reminder":
      return "Programmer un rappel";
    case "open_inbox":
      return "Ouvrir la boîte de réception";
    case "open_tasks":
      return "Ouvrir les tâches";
    case "none":
      return "Aucune action automatique";
  }
}

function ActionSummary({ action }: { action: ProposedAction }) {
  switch (action.type) {
    case "create_task":
      return (
        <div className="text-xs text-muted-foreground">
          <div>📋 {action.title}</div>
          <div>
            Priorité : {action.priority}
            {action.due_in_hours != null && ` · Échéance dans ${action.due_in_hours}h`}
          </div>
        </div>
      );
    case "create_event":
      return (
        <div className="text-xs text-muted-foreground">
          <div>📅 {action.title}</div>
          <div>
            {new Date(action.start_iso).toLocaleString("fr-FR")} ({action.duration_min} min)
          </div>
        </div>
      );
    case "reminder":
      return (
        <div className="text-xs text-muted-foreground">
          <div>🔔 {action.title}</div>
          <div>Dans {action.remind_in_hours}h</div>
        </div>
      );
    default:
      return null;
  }
}

function EditActionForm({
  action,
  onChange,
  onCancel,
  onSave,
}: {
  action: ProposedAction;
  onChange: (a: ProposedAction) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (action.type === "create_task") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Titre</Label>
          <Input
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Priorité</Label>
            <Select
              value={action.priority}
              onValueChange={(v) =>
                onChange({ ...action, priority: v as "low" | "medium" | "high" | "urgent" })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Faible</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Échéance (heures)</Label>
            <Input
              type="number"
              value={action.due_in_hours ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  due_in_hours: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="h-8 text-sm"
              placeholder="Aucune"
            />
          </div>
        </div>
        <EditFormActions onCancel={onCancel} onSave={onSave} />
      </div>
    );
  }
  if (action.type === "create_event") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Titre</Label>
          <Input
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Début</Label>
            <Input
              type="datetime-local"
              value={toLocalInput(action.start_iso)}
              onChange={(e) =>
                onChange({ ...action, start_iso: new Date(e.target.value).toISOString() })
              }
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Durée (min)</Label>
            <Input
              type="number"
              value={action.duration_min}
              onChange={(e) =>
                onChange({ ...action, duration_min: Number(e.target.value) || 30 })
              }
              className="h-8 text-sm"
            />
          </div>
        </div>
        <EditFormActions onCancel={onCancel} onSave={onSave} />
      </div>
    );
  }
  if (action.type === "reminder") {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Titre</Label>
          <Input
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Rappel dans (heures)</Label>
          <Input
            type="number"
            value={action.remind_in_hours}
            onChange={(e) =>
              onChange({ ...action, remind_in_hours: Number(e.target.value) || 1 })
            }
            className="h-8 text-sm"
          />
        </div>
        <EditFormActions onCancel={onCancel} onSave={onSave} />
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
      Pas de paramètres modifiables pour cette action.
      <div className="mt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Retour
        </Button>
      </div>
    </div>
  );
}

function EditFormActions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Annuler
      </Button>
      <Button size="sm" onClick={onSave}>
        <Check className="mr-1 h-3.5 w-3.5" /> Appliquer
      </Button>
    </div>
  );
}

function toLocalInput(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}
