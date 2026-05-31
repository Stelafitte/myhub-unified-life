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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  Wand2,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  ListTodo,
  CalendarPlus,
  Mail,
  Bell,
  Inbox,
  ArrowLeft,
  Trash2,
  ChevronRight,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import { SwipeableRow } from "@/components/inbox/swipeable-row";
import {
  proposeInsightAction,
  type ProposedAction,
} from "@/lib/api/insight-action.functions";
import type { InsightOrigin } from "@/lib/api/dashboard-insights.functions";

export type InsightItem = {
  kind: "suggestion" | "alert";
  text: string;
  origin?: InsightOrigin;
  sourceIndex: number;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
  items: InsightItem[];
  context?: { unreadCount?: number; overdueCount?: number; todayEvents?: number };
  onDismiss?: (kind: "suggestion" | "alert", sourceIndex: number) => void;
};

export function InsightsProcessorDialog({
  open,
  onOpenChange,
  userId,
  items,
  context,
  onDismiss,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Reset detail view on open / list change
  useEffect(() => {
    if (!open) setActiveId(null);
  }, [open]);

  const active = useMemo(
    () => items.find((it) => itemId(it) === activeId) ?? null,
    [items, activeId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {active ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 -ml-2"
                  onClick={() => setActiveId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                Suggestion
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 text-primary" /> Suggestions IA ({items.length})
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Aucune suggestion à traiter.
          </div>
        ) : active ? (
          <DetailView
            item={active}
            userId={userId}
            context={context}
            onClose={() => setActiveId(null)}
            onDone={() => {
              onDismiss?.(active.kind, active.sourceIndex);
              setActiveId(null);
            }}
            onNavigate={() => onOpenChange(false)}
          />
        ) : (
          <ListView
            items={items}
            onOpen={(it) => setActiveId(itemId(it))}
            onDismiss={(it) => onDismiss?.(it.kind, it.sourceIndex)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function itemId(it: InsightItem) {
  return `${it.kind}:${it.sourceIndex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// List view (swipe to delete, click to open)
// ─────────────────────────────────────────────────────────────────────────────
function ListView({
  items,
  onOpen,
  onDismiss,
}: {
  items: InsightItem[];
  onOpen: (it: InsightItem) => void;
  onDismiss: (it: InsightItem) => void;
}) {
  const emailMap = useOriginEmails(items);
  return (
    <div className="-mx-6 max-h-[60vh] overflow-y-auto">
      <ul className="divide-y">
        {items.map((it) => {
          const email = resolveEmail(it.origin, emailMap);
          return (
            <li key={itemId(it)}>
              <SwipeableRow
                rightActions={[
                  {
                    key: "del",
                    label: "Suppr.",
                    icon: <Trash2 className="h-4 w-4" />,
                    color: "bg-destructive",
                    onAction: () => onDismiss(it),
                  },
                ]}
              >
                <button
                  type="button"
                  onClick={() => onOpen(it)}
                  className="flex w-full items-start gap-3 px-6 py-3 text-left hover:bg-accent/40"
                >
                  <div className="mt-0.5 shrink-0">
                    {it.kind === "alert" ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug break-words">{it.text}</p>
                    {email ? (
                      <div className="mt-2 rounded-md border bg-muted/40 p-2 text-[11px]">
                        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">
                            {email.from_name || email.from_address || "Expéditeur inconnu"}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate font-medium text-foreground">
                          {email.subject || "(sans objet)"}
                        </div>
                        {(email.ai_summary || email.body_text) && (
                          <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                            {email.ai_summary || (email.body_text ?? "").slice(0, 180)}
                          </p>
                        )}
                      </div>
                    ) : (
                      it.origin && it.origin.type !== "none" && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <OriginIcon type={it.origin.type} />
                          <span className="truncate">{originLabel(it.origin)}</span>
                        </p>
                      )
                    )}
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </SwipeableRow>
            </li>
          );
        })}
      </ul>
      <p className="px-6 py-2 text-[11px] text-muted-foreground">
        Astuce : glissez une ligne vers la gauche pour la supprimer.
      </p>
    </div>
  );
}

type OriginEmail = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  body_text: string | null;
  ai_summary: string | null;
};

function resolveEmail(
  origin: InsightOrigin | undefined,
  map: Map<string, OriginEmail>,
): OriginEmail | null {
  if (!origin || !origin.refId) return null;
  // direct email ref OR resolved via task → source_email_id (stored under task refId key)
  return map.get(origin.refId) ?? null;
}

function useOriginEmails(items: InsightItem[]): Map<string, OriginEmail> {
  const [map, setMap] = useState<Map<string, OriginEmail>>(new Map());
  const keys = items
    .map((it) => (it.origin && it.origin.refId ? `${it.origin.type}:${it.origin.refId}` : ""))
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const emailIds = new Set<string>();
      const taskIds = new Set<string>();
      for (const it of items) {
        if (!it.origin?.refId) continue;
        if (it.origin.type === "email") emailIds.add(it.origin.refId);
        else if (it.origin.type === "task") taskIds.add(it.origin.refId);
      }
      // Resolve task → source_email_id
      const taskEmail = new Map<string, string>(); // taskId -> emailId
      if (taskIds.size > 0) {
        const { data } = await supabase
          .from("tasks")
          .select("id, source_email_id")
          .in("id", Array.from(taskIds));
        for (const t of data ?? []) {
          if (t.source_email_id) {
            taskEmail.set(t.id, t.source_email_id);
            emailIds.add(t.source_email_id);
          }
        }
      }
      if (emailIds.size === 0) {
        if (!cancelled) setMap(new Map());
        return;
      }
      const { data: emails } = await supabase
        .from("emails")
        .select("id, subject, from_name, from_address, body_text, ai_summary")
        .in("id", Array.from(emailIds));
      const byEmailId = new Map<string, OriginEmail>();
      for (const e of emails ?? []) byEmailId.set(e.id, e as OriginEmail);
      // Build the final map keyed by refId (email refId OR task refId)
      const result = new Map<string, OriginEmail>();
      for (const it of items) {
        if (!it.origin?.refId) continue;
        if (it.origin.type === "email") {
          const e = byEmailId.get(it.origin.refId);
          if (e) result.set(it.origin.refId, e);
        } else if (it.origin.type === "task") {
          const eid = taskEmail.get(it.origin.refId);
          if (eid) {
            const e = byEmailId.get(eid);
            if (e) result.set(it.origin.refId, e);
          }
        }
      }
      if (!cancelled) setMap(result);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail view (origin + AI proposed action with apply/edit/skip)
// ─────────────────────────────────────────────────────────────────────────────
function DetailView({
  item,
  userId,
  context,
  onClose,
  onDone,
  onNavigate,
}: {
  item: InsightItem;
  userId?: string;
  context?: { unreadCount?: number; overdueCount?: number; todayEvents?: number };
  onClose: () => void;
  onDone: () => void;
  onNavigate: () => void;
}) {
  const propose = useServerFn(proposeInsightAction);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<ProposedAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ProposedAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAction(null);
    setEditing(false);
    propose({ data: { text: item.text, kind: item.kind, context } })
      .then((res) => {
        if (cancelled) return;
        setAction(res);
        setEditForm(res);
      })
      .catch(() => {
        if (!cancelled) setAction({ type: "none", reason: "Analyse IA indisponible." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId(item)]);

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
          // Résolution de la source email :
          // 1. Si l'origine est un mail => utiliser directement le refId
          // 2. Si l'origine est une tâche => hériter du source_email_id de la tâche parente
          let sourceEmailId: string | null = null;
          if (item.origin?.type === "email" && item.origin.refId) {
            sourceEmailId = item.origin.refId;
          } else if (item.origin?.type === "task" && item.origin.refId) {
            const { data: parent } = await supabase
              .from("tasks")
              .select("source_email_id")
              .eq("id", item.origin.refId)
              .maybeSingle();
            sourceEmailId = parent?.source_email_id ?? null;
          }
          const { error } = await supabase.from("tasks").insert({
            user_id: userId,
            title: a.title,
            status: "todo",
            priority,
            due_date: due,
            source_email_id: sourceEmailId,
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
          onNavigate();
          navigate({ to: "/inbox" });
          return;
        }
        case "open_tasks": {
          onNavigate();
          navigate({ to: "/tasks" });
          return;
        }
        case "none":
        default:
          toast.message("Aucune action exécutée");
          break;
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const ActionIcon = action ? actionIcon(action.type) : Sparkles;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          {item.kind === "alert" ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Alerte
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Suggestion
            </Badge>
          )}
        </div>
        <p className="text-sm leading-snug">{item.text}</p>
      </div>

      <OriginPanel
        origin={item.origin}
        onOpen={() => {
          onNavigate();
        }}
      />

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
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Retour
            </Button>
            <Button variant="ghost" size="sm" onClick={onDone} disabled={loading}>
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Origin panel
// ─────────────────────────────────────────────────────────────────────────────
function OriginPanel({
  origin,
  onOpen,
}: {
  origin?: InsightOrigin;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  if (!origin || origin.type === "none") {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <LinkIcon className="h-3.5 w-3.5" /> Origine : analyse globale (pas de mail ni tâche
          source identifiée).
        </div>
      </div>
    );
  }
  const open = () => {
    onOpen();
    if (origin.type === "email") navigate({ to: "/inbox" });
    else if (origin.type === "task") navigate({ to: "/tasks" });
    else if (origin.type === "calendar") navigate({ to: "/calendar" });
  };
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <OriginIcon type={origin.type} /> Origine : {originTypeLabel(origin.type)}
      </div>
      {origin.label && (
        <div className="break-words text-sm">{origin.label}</div>
      )}
      <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" onClick={open}>
        Ouvrir {originTypeLabel(origin.type).toLowerCase()}
      </Button>
    </div>
  );
}

function OriginIcon({ type }: { type: InsightOrigin["type"] }) {
  const cls = "h-3.5 w-3.5";
  switch (type) {
    case "email":
      return <Mail className={cls} />;
    case "task":
      return <ListTodo className={cls} />;
    case "calendar":
      return <CalendarPlus className={cls} />;
    default:
      return <LinkIcon className={cls} />;
  }
}

function originTypeLabel(t: InsightOrigin["type"]) {
  switch (t) {
    case "email":
      return "Mail";
    case "task":
      return "Tâche";
    case "calendar":
      return "Agenda";
    default:
      return "Aucune";
  }
}

function originLabel(o: InsightOrigin) {
  if (o.label) return o.label;
  return originTypeLabel(o.type);
}

// ─────────────────────────────────────────────────────────────────────────────
// Action helpers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
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
