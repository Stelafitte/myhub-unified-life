import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Repeat, Sparkles } from "lucide-react";
import { toast } from "sonner";

export type RecurrenceKind = "none" | "weekly" | "biweekly" | "monthly" | "custom";

export function recurrenceLabel(rule: string | null | undefined): string {
  if (!rule) return "Aucune";
  if (rule === "weekly") return "Hebdomadaire";
  if (rule === "biweekly") return "Bi-hebdomadaire";
  if (rule === "monthly") return "Mensuelle";
  if (rule.startsWith("custom:")) return `Tous les ${rule.slice(7)}`;
  return rule;
}

function addOccurrence(base: Date, kind: RecurrenceKind, customDays: number, idx: number): Date {
  const d = new Date(base);
  switch (kind) {
    case "weekly":
      d.setDate(d.getDate() + 7 * idx);
      return d;
    case "biweekly":
      d.setDate(d.getDate() + 14 * idx);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + idx);
      return d;
    case "custom":
      d.setDate(d.getDate() + customDays * idx);
      return d;
    default:
      return d;
  }
}

export function RecurrenceSection({
  meetingId,
  userId,
  startAt,
  endAt,
  parentId,
  currentRule,
  sessionNumber,
  onGenerated,
}: {
  meetingId: string;
  userId: string;
  startAt: string;
  endAt: string;
  parentId: string | null;
  currentRule: string | null;
  sessionNumber: number | null;
  onGenerated?: () => void;
}) {
  const initialKind: RecurrenceKind =
    !currentRule
      ? "none"
      : currentRule.startsWith("custom:")
        ? "custom"
        : (currentRule as RecurrenceKind);
  const [kind, setKind] = useState<RecurrenceKind>(initialKind);
  const [customDays, setCustomDays] = useState<number>(
    currentRule?.startsWith("custom:") ? parseInt(currentRule.slice(7)) || 21 : 21,
  );
  const [count, setCount] = useState<number>(6);
  const [busy, setBusy] = useState(false);
  const isChild = !!parentId;

  async function generate() {
    if (kind === "none") {
      toast.error("Choisissez une récurrence");
      return;
    }
    if (count < 2 || count > 52) {
      toast.error("Entre 2 et 52 occurrences");
      return;
    }
    setBusy(true);
    try {
      const rule = kind === "custom" ? `custom:${customDays}d` : kind;
      // Load source meeting for cloning
      const { data: source } = await supabase
        .from("meetings")
        .select("*")
        .eq("id", meetingId)
        .single();
      if (!source) throw new Error("Réunion source introuvable");
      const { data: parts } = await supabase
        .from("meeting_participants")
        .select("email,name,role,rsvp_status")
        .eq("meeting_id", meetingId);
      const { data: agenda } = await supabase
        .from("meeting_agenda_items")
        .select("title,duration_minutes,responsible_email,responsible_name,position")
        .eq("meeting_id", meetingId)
        .order("position", { ascending: true });

      // Mark parent
      await supabase
        .from("meetings")
        .update({ recurrence_rule: rule, session_number: 1 })
        .eq("id", meetingId);

      const baseStart = new Date(startAt);
      const baseEnd = new Date(endAt);
      const created: string[] = [];
      for (let i = 1; i < count; i++) {
        const ns = addOccurrence(baseStart, kind, customDays, i).toISOString();
        const ne = addOccurrence(baseEnd, kind, customDays, i).toISOString();
        const payload = {
          user_id: userId,
          title: source.title,
          description: source.description,
          importance: source.importance,
          start_at: ns,
          end_at: ne,
          location: source.location,
          is_online: source.is_online,
          online_link: source.online_link,
          online_provider: source.online_provider,
          zoom_password: source.zoom_password,
          organizer_email: source.organizer_email,
          organizer_name: source.organizer_name,
          status: "scheduled",
          recurrence_rule: rule,
          recurrence_parent_id: meetingId,
          session_number: i + 1,
          quorum_minimum: source.quorum_minimum,
          room: source.room,
        };
        const { data: inserted, error } = await supabase
          .from("meetings")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        created.push(inserted.id);
        if (parts && parts.length) {
          await supabase.from("meeting_participants").insert(
            parts.map((p) => ({
              meeting_id: inserted.id,
              user_id: userId,
              email: p.email,
              name: p.name,
              role: p.role,
              rsvp_status: "pending",
            })),
          );
        }
        if (agenda && agenda.length) {
          await supabase.from("meeting_agenda_items").insert(
            agenda.map((a) => ({
              meeting_id: inserted.id,
              user_id: userId,
              title: a.title,
              duration_minutes: a.duration_minutes,
              responsible_email: a.responsible_email,
              responsible_name: a.responsible_name,
              position: a.position,
              status: "pending",
            })),
          );
        }
      }
      toast.success(`${created.length} occurrence(s) créée(s)`);
      onGenerated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur génération");
    } finally {
      setBusy(false);
    }
  }

  if (isChild) {
    return (
      <div className="rounded-md border bg-muted/10 p-3 text-sm flex items-center gap-2 flex-wrap">
        <Repeat className="h-4 w-4 text-primary" />
        <span>Série {recurrenceLabel(currentRule)}</span>
        {sessionNumber && (
          <Badge variant="secondary" className="text-[10px]">
            Session #{sessionNumber}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4" />
        <Label className="text-sm font-medium">🔁 Récurrence</Label>
        {currentRule && (
          <Badge variant="secondary" className="text-[10px]">
            {recurrenceLabel(currentRule)}
            {sessionNumber ? ` · #${sessionNumber}` : ""}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
        <div>
          <Label className="text-[10px] text-muted-foreground">Fréquence</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as RecurrenceKind)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucune</SelectItem>
              <SelectItem value="weekly">Hebdomadaire</SelectItem>
              <SelectItem value="biweekly">Bi-hebdomadaire</SelectItem>
              <SelectItem value="monthly">Mensuelle</SelectItem>
              <SelectItem value="custom">Personnalisée (jours)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {kind === "custom" && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Intervalle (j)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value) || 1))}
              className="h-9"
            />
          </div>
        )}
        <div>
          <Label className="text-[10px] text-muted-foreground">Occurrences</Label>
          <Input
            type="number"
            min={2}
            max={52}
            value={count}
            onChange={(e) => setCount(Math.max(2, Math.min(52, Number(e.target.value) || 2)))}
            className="h-9"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={generate}
          disabled={busy || kind === "none"}
          className="h-9"
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {busy ? "Génération…" : "Générer"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Les participants, l'ordre du jour et la visio sont copiés sur chaque occurrence.
      </p>
    </div>
  );
}
