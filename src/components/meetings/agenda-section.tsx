import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Plus,
  Trash2,
  Play,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RunningMeetingMode } from "./running-meeting-mode";

export type AgendaItem = {
  id: string;
  meeting_id: string;
  user_id: string;
  title: string;
  duration_minutes: number;
  responsible_email: string | null;
  responsible_name: string | null;
  position: number;
  status: "pending" | "in_progress" | "done" | "postponed";
};

const STATUS_META: Record<
  AgendaItem["status"],
  { label: string; cls: string; emoji: string }
> = {
  pending: {
    label: "À traiter",
    emoji: "⬜",
    cls: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "En cours",
    emoji: "🔄",
    cls: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  },
  done: {
    label: "Traité",
    emoji: "✅",
    cls: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  },
  postponed: {
    label: "Reporté",
    emoji: "⏭",
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
};

type Participant = { email: string; name?: string };

function SortableRow({
  item,
  participants,
  onChange,
  onDelete,
}: {
  item: AgendaItem;
  participants: Participant[];
  onChange: (patch: Partial<AgendaItem>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-md border bg-card p-2"
    >
      <button
        type="button"
        className="mt-2 cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Réorganiser"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 space-y-2">
        <Input
          value={item.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Titre du point"
          className="h-8"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Durée (min)</Label>
            <Input
              type="number"
              min={1}
              max={480}
              value={item.duration_minutes}
              onChange={(e) =>
                onChange({ duration_minutes: Math.max(1, Number(e.target.value) || 1) })
              }
              className="h-8"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Responsable</Label>
            <Select
              value={item.responsible_email ?? "__none"}
              onValueChange={(v) => {
                if (v === "__none") {
                  onChange({ responsible_email: null, responsible_name: null });
                } else {
                  const p = participants.find((x) => x.email === v);
                  onChange({
                    responsible_email: v,
                    responsible_name: p?.name ?? null,
                  });
                }
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Aucun —</SelectItem>
                {participants.map((p) => (
                  <SelectItem key={p.email} value={p.email}>
                    {p.name || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Statut</Label>
            <Select
              value={item.status}
              onValueChange={(v) => onChange({ status: v as AgendaItem["status"] })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_META) as AgendaItem["status"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_META[k].emoji} {STATUS_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        aria-label="Supprimer"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AgendaSection({
  meetingId,
  meetingTitle,
  meetingStartAt,
  meetingEndAt,
  participants,
  userId,
}: {
  meetingId: string;
  meetingTitle: string;
  meetingStartAt: string;
  meetingEndAt: string;
  participants: Participant[];
  userId: string;
}) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("meeting_agenda_items")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("position", { ascending: true });
      if (cancelled) return;
      if (error) {
        toast.error("Impossible de charger l'ordre du jour");
      } else {
        setItems((data ?? []) as AgendaItem[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const meetingDurationMin = Math.max(
    0,
    Math.round((new Date(meetingEndAt).getTime() - new Date(meetingStartAt).getTime()) / 60000),
  );
  const totalAgendaMin = items.reduce((s, i) => s + (i.duration_minutes || 0), 0);
  const overbooked = meetingDurationMin > 0 && totalAgendaMin > meetingDurationMin;

  async function addItem() {
    const position = items.length;
    const { data, error } = await supabase
      .from("meeting_agenda_items")
      .insert({
        meeting_id: meetingId,
        user_id: userId,
        title: "Nouveau point",
        duration_minutes: 15,
        position,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) {
      toast.error("Ajout impossible");
      return;
    }
    setItems((prev) => [...prev, data as AgendaItem]);
  }

  async function updateItem(id: string, patch: Partial<AgendaItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase
      .from("meeting_agenda_items")
      .update(patch)
      .eq("id", id);
    if (error) toast.error("Sauvegarde impossible");
  }

  async function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    const { error } = await supabase.from("meeting_agenda_items").delete().eq("id", id);
    if (error) toast.error("Suppression impossible");
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex).map((it, idx) => ({
      ...it,
      position: idx,
    }));
    setItems(reordered);
    // Persist new positions
    await Promise.all(
      reordered.map((it) =>
        supabase.from("meeting_agenda_items").update({ position: it.position }).eq("id", it.id),
      ),
    );
  }

  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          <Label className="text-sm font-medium">📋 Ordre du jour</Label>
          <Badge variant="secondary" className="text-[10px]">
            {totalAgendaMin} / {meetingDurationMin} min
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={addItem}>
            <Plus className="h-4 w-4 mr-1" /> Ajouter un point
          </Button>
          {items.length > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={() => setRunning(true)}
              className="bg-primary"
            >
              <Play className="h-4 w-4 mr-1" /> Démarrer
            </Button>
          )}
        </div>
      </div>

      {overbooked && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            ⚠️ Ordre du jour trop chargé ({totalAgendaMin} min planifiées pour{" "}
            {meetingDurationMin} min de réunion)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Aucun point. Cliquez sur « Ajouter un point ».
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
                  participants={participants}
                  onChange={(patch) => updateItem(it.id, patch)}
                  onDelete={() => deleteItem(it.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t">
          {(Object.keys(STATUS_META) as AgendaItem["status"][]).map((k) => {
            const count = items.filter((i) => i.status === k).length;
            if (count === 0) return null;
            return (
              <Badge key={k} variant="secondary" className={cn("text-[10px]", STATUS_META[k].cls)}>
                {STATUS_META[k].emoji} {count}
              </Badge>
            );
          })}
        </div>
      )}

      {running && (
        <RunningMeetingMode
          meetingTitle={meetingTitle}
          items={items}
          onClose={() => setRunning(false)}
          onItemStatusChange={(id, status) => updateItem(id, { status })}
        />
      )}
    </div>
  );
}
