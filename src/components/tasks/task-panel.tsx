import { useEffect, useRef, useState } from "react";
import { Search, Mail, X, Sparkles, CalendarPlus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { enqueue, requestAutoSync } from "@/lib/sync-queue";
import { analyzeTaskText } from "@/lib/api/task-analysis.functions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskSource,
  PRIORITY_META,
  STATUS_COLUMNS,
  SOURCE_META,
  DEFAULT_SECTIONS,
  getSection,
  withoutSection,
} from "@/lib/tasks-model";

type Draft = {
  title?: string;
  description?: string;
  due?: string; // YYYY-MM-DD
  start?: string; // YYYY-MM-DD
  calendarEventId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: Task | null;
  defaultStatus?: TaskStatus;
  sections: string[];
  onSaved: (task: Task) => void;
  draft?: Draft | null;
};

type EmailLite = { id: string; subject: string | null; from_name: string | null; from_address: string | null };

export function TaskPanel({ open, onOpenChange, task, defaultStatus, sections, onSaved, draft }: Props) {
  const { user } = useAuth();
  const editing = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [section, setSection] = useState<string>("Autre");
  const [newSection, setNewSection] = useState("");
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  const [reminder, setReminder] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [source, setSource] = useState<TaskSource>("myhubpro");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [emailId, setEmailId] = useState<string | null>(null);
  const [emailLabel, setEmailLabel] = useState<string>("");
  const [emailSearch, setEmailSearch] = useState("");
  const [emailResults, setEmailResults] = useState<EmailLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [addToCalendar, setAddToCalendar] = useState(false);
  // Tracks the last initialized panel context to avoid clobbering user input on parent re-renders
  const initKeyRef = useRef<string>("");

  const todayStr = () => {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  };
  const addDaysStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  };

  useEffect(() => {
    if (!open) {
      initKeyRef.current = "";
      return;
    }
    // Only reset when the panel is opened or the target task changes — not on every parent re-render
    const key = task ? `edit:${task.id}` : `new:${defaultStatus ?? "todo"}`;
    if (initKeyRef.current === key) return;
    initKeyRef.current = key;

    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setComments((task as Task & { comments?: string | null }).comments ?? "");
      setPriority(task.priority);
      setStatus(task.status);
      setSection(getSection(task));
      setStart(task.gantt_start ? task.gantt_start.slice(0, 10) : "");
      setDue(task.due_date ? task.due_date.slice(0, 10) : "");
      setReminder(task.reminder_at ? task.reminder_at.slice(0, 16) : "");
      setTagsText(withoutSection(task.tags).filter((t) => !t.startsWith("recurrence:")).join(", "));
      const rec = (task.tags ?? []).find((t) => t.startsWith("recurrence:"));
      setRecurrence((rec ? rec.slice(11) : "none") as typeof recurrence);
      setSource(task.source_app);
      setEmailId(task.source_email_id);
      setEmailLabel("");
      setAddToCalendar(!!(task as Task & { calendar_event_id?: string | null }).calendar_event_id);
    } else {
      // Defaults: today for start, today for due (when no AI is used)
      const today = todayStr();
      setTitle(draft?.title ?? "");
      setDescription(draft?.description ?? "");
      setComments("");
      setPriority("medium");
      setStatus(defaultStatus ?? "todo");
      setSection("Autre");
      setStart(draft?.start ?? today);
      setDue(draft?.due ?? today);
      setReminder("");
      setTagsText("");
      setRecurrence("none");
      setSource("myhubpro");
      setEmailId(null);
      setEmailLabel("");
      setAddToCalendar(!!draft?.calendarEventId);
    }
    setNewSection("");
    setEmailSearch("");
    setEmailResults([]);
  }, [open, task, defaultStatus]);

  // Load linked email label
  useEffect(() => {
    if (!emailId) { setEmailLabel(""); return; }
    supabase.from("emails").select("subject,from_name,from_address").eq("id", emailId).maybeSingle()
      .then(({ data }) => {
        if (data) setEmailLabel(`${data.subject ?? "(sans objet)"} — ${data.from_name || data.from_address || ""}`);
      });
  }, [emailId]);

  // Email search
  useEffect(() => {
    if (!emailSearch.trim()) { setEmailResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("emails")
        .select("id,subject,from_name,from_address")
        .or(`subject.ilike.%${emailSearch}%,from_name.ilike.%${emailSearch}%,from_address.ilike.%${emailSearch}%`)
        .limit(8);
      setEmailResults((data ?? []) as EmailLite[]);
    }, 250);
    return () => clearTimeout(t);
  }, [emailSearch]);

  const sectionsAll = Array.from(new Set([...DEFAULT_SECTIONS, ...sections]));

  const runAi = async () => {
    const text = `${title}\n${description}\n${comments}`.trim();
    if (!text) { toast.error("Remplis au moins le titre ou la description avant d'analyser."); return; }
    setAnalyzing(true);
    try {
      const res = await analyzeTaskText({ data: { text } });
      if (res.title) setTitle(res.title);
      if (res.description) setDescription(res.description);
      if (res.comments) setComments(res.comments);
      if (res.priority) setPriority(res.priority);

      // Échéance : utiliser celle de l'IA, ou proposer un défaut intelligent selon la priorité
      const inferredPriority = res.priority ?? priority;
      const defaultOffsetDays =
        inferredPriority === "urgent" ? 2 :
        inferredPriority === "high" ? 5 :
        inferredPriority === "low" ? 14 : 7;
      const nextDue = res.due_date ?? addDaysStr(defaultOffsetDays);
      setDue(nextDue);

      // Début : celui de l'IA, sinon aujourd'hui
      const nextStart = res.gantt_start ?? todayStr();
      setStart(nextStart);

      if (res.tags && res.tags.length > 0) {
        const existing = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
        const merged = Array.from(new Set([...existing, ...res.tags]));
        setTagsText(merged.join(", "));
      }
      if (res.section && sectionsAll.includes(res.section)) setSection(res.section);
      toast.success("Champs pré-remplis par l'IA");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'analyse IA");
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) { toast.error("Titre requis"); return; }
    if (!user) return;
    setSaving(true);

    const finalSection = newSection.trim() || section;
    const tags = [
      ...tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      `section:${finalSection}`,
      ...(recurrence !== "none" ? [`recurrence:${recurrence}`] : []),
    ];

    const payload = {
      user_id: user.id,
      title: title.trim(),
      description: description || null,
      comments: comments || null,
      priority,
      status,
      due_date: due ? new Date(`${due}T00:00:00`).toISOString() : null,
      gantt_start: start ? new Date(`${start}T00:00:00`).toISOString() : null,
      gantt_end: due ? new Date(`${due}T00:00:00`).toISOString() : null,
      reminder_at: reminder ? new Date(reminder).toISOString() : null,
      source_app: source,
      source_email_id: emailId,
      tags,
      kanban_column: status,
      ...(!editing && draft?.calendarEventId ? { calendar_event_id: draft.calendarEventId } : {}),
    };

    try {
      let savedTask: Task | null = null;
      if (navigator.onLine) {
        if (editing && task) {
          const { data, error } = await supabase.from("tasks").update(payload).eq("id", task.id).select().single();
          if (error) throw error;
          savedTask = data as Task;
          toast.success("Tâche mise à jour");
        } else {
          const { data, error } = await supabase.from("tasks").insert(payload).select().single();
          if (error) throw error;
          savedTask = data as Task;
          toast.success("Tâche créée");
        }

        // Création / mise à jour de l'événement agenda lié
        const existingEventId = (task as Task & { calendar_event_id?: string | null } | null)?.calendar_event_id ?? null;
        if (addToCalendar && savedTask) {
          const startDateStr = start || todayStr();
          const endDateStr = due || startDateStr;
          const startIso = new Date(`${startDateStr}T09:00:00`).toISOString();
          const endIso = new Date(`${endDateStr}T10:00:00`).toISOString();
          const eventPayload = {
            user_id: user.id,
            title: payload.title,
            description: payload.description,
            start_at: startIso,
            end_at: endIso,
            is_all_day: false,
          };
          if (existingEventId) {
            await supabase.from("calendar_events").update(eventPayload).eq("id", existingEventId);
          } else {
            const { data: ev } = await supabase.from("calendar_events").insert(eventPayload).select("id").single();
            if (ev?.id) {
              await supabase.from("tasks").update({ calendar_event_id: ev.id }).eq("id", savedTask.id);
              savedTask = { ...savedTask, calendar_event_id: ev.id } as Task;
            }
          }
        } else if (!addToCalendar && existingEventId) {
          await supabase.from("calendar_events").delete().eq("id", existingEventId);
          await supabase.from("tasks").update({ calendar_event_id: null }).eq("id", savedTask.id);
          savedTask = { ...savedTask, calendar_event_id: null } as Task;
        }

        onSaved(savedTask);
      } else {
        // Offline: queue and create optimistic record
        const optimistic: Task = {
          ...(task ?? {}),
          ...payload,
          id: task?.id ?? crypto.randomUUID(),
          created_at: task?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
          assigned_to: task?.assigned_to ?? null,
          gantt_color: task?.gantt_color ?? null,
          _pending: true,
        } as Task;
        await enqueue({
          entity_type: "task",
          entity_id: editing ? task!.id : optimistic.id,
          action: editing ? "update" : "create",
          payload: editing ? payload : { ...payload, id: optimistic.id },
        });
        onSaved(optimistic);
        toast.success(editing ? "Modification mise en file (offline)" : "Création mise en file (offline)");
      }
      // Auto-sync after any create/update so the change propagates immediately.
      requestAutoSync();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Modifier la tâche" : "Nouvelle tâche"}</SheetTitle>
        </SheetHeader>

        <button
          type="button"
          onClick={runAi}
          disabled={analyzing}
          className={cn(
            "mt-4 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity",
            analyzing ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90"
          )}
        >
          <Sparkles className="h-4 w-4" />
          {analyzing ? "Analyse en cours…" : "✨ Analyser avec l'IA"}
        </button>

        <div className="mt-3 space-y-4">
          <div>
            <Label htmlFor="t-title">Titre *</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Préparer la présentation" />
          </div>

          <div>
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="t-comments">Commentaires</Label>
            <Textarea
              id="t-comments"
              rows={3}
              placeholder="Notes libres, contexte, points d'attention…"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>

          {task && Array.isArray((task as Task & { attachments?: unknown[] }).attachments) && ((task as Task & { attachments?: unknown[] }).attachments?.length ?? 0) > 0 && (
            <div>
              <Label className="mb-1.5 block">Pièces jointes ({(task as Task & { attachments?: unknown[] }).attachments!.length})</Label>
              <ul className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
                {((task as Task & { attachments?: Array<{ name?: string; url?: string | null }> }).attachments ?? []).map((a, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    📎 {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="underline">{a.name ?? `Fichier ${i + 1}`}</a> : <span>{a.name ?? `Fichier ${i + 1}`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {task && (task as Task & { calendar_event_id?: string | null }).calendar_event_id && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              📅 Lié à un événement de l'agenda
            </div>
          )}

          <div>
            <Label className="mb-1.5 block">Priorité</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(PRIORITY_META) as TaskPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors",
                    priority === p ? "border-primary bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  <span>{PRIORITY_META[p].emoji}</span>
                  <span>{PRIORITY_META[p].label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Statut</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_COLUMNS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.icon} {c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as TaskSource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_META) as TaskSource[]).map((s) => (
                    <SelectItem key={s} value={s}>{SOURCE_META[s].emoji} {SOURCE_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-start">Date début</Label>
              <Input id="t-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-due">Échéance</Label>
              <Input id="t-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="t-rem">Rappel</Label>
            <Input id="t-rem" type="datetime-local" value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </div>

          <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 cursor-pointer">
            <Checkbox
              checked={addToCalendar}
              onCheckedChange={(v) => {
                const checked = v === true;
                setAddToCalendar(checked);
                if (checked) {
                  // Reporter les dates de la tâche dans l'agenda
                  if (!start) setStart(todayStr());
                  if (!due) setDue(start || todayStr());
                }
              }}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <CalendarPlus className="h-4 w-4 text-primary" />
                Ajouter à l'agenda
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Crée un événement du <strong>{start || "—"}</strong> au <strong>{due || start || "—"}</strong> lié à cette tâche.
              </p>
            </div>
          </label>

          <div>
            <Label>Section / projet</Label>
            <div className="flex gap-2">
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sectionsAll.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input
              className="mt-2"
              placeholder="…ou créer une nouvelle section"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="t-tags">Tags (séparés par des virgules)</Label>
            <Input id="t-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ex. urgent, client, q4" />
          </div>

          <div>
            <Label>Récurrence</Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v as typeof recurrence)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune</SelectItem>
                <SelectItem value="daily">Quotidienne</SelectItem>
                <SelectItem value="weekly">Hebdomadaire</SelectItem>
                <SelectItem value="monthly">Mensuelle</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Email source lié</Label>
            {emailId ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{emailLabel || `Email ${emailId.slice(0, 8)}…`}</span>
                <button onClick={() => { setEmailId(null); setEmailLabel(""); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Rechercher un email…" value={emailSearch} onChange={(e) => setEmailSearch(e.target.value)} />
                </div>
                {emailResults.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover text-xs">
                    {emailResults.map((e) => (
                      <li key={e.id}>
                        <button
                          className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-accent"
                          onClick={() => { setEmailId(e.id); setEmailSearch(""); setEmailResults([]); }}
                        >
                          <span className="font-medium">{e.subject || "(sans objet)"}</span>
                          <span className="text-muted-foreground">{e.from_name || e.from_address}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {!navigator.onLine && (
            <Badge variant="secondary" className="w-full justify-center">⚡ Hors-ligne — sera mis en file</Badge>
          )}

          <div className="sticky bottom-0 -mx-6 flex gap-2 border-t bg-background px-6 py-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button className="flex-1" onClick={submit} disabled={saving}>
              {saving ? "Enregistrement…" : editing ? "Mettre à jour" : "Créer"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
