import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Sun, Sunset, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { findAvailableSlots, type AvailableSlot } from "@/lib/api/meetings.functions";
import { cn } from "@/lib/utils";

type Props = {
  /** Duration to look for, in minutes. */
  durationMinutes: number;
  /** Called when the user picks a slot. ISO strings. */
  onPick: (slot: { startAt: string; endAt: string }) => void;
  /** Optional: allow picking multiple slots (returns true to keep selected style) */
  isSelected?: (slot: AvailableSlot) => boolean;
  /** Compact label for the trigger button. */
  triggerLabel?: string;
};

export function SlotFinder({ durationMinutes, onPick, isSelected, triggerLabel }: Props) {
  const find = useServerFn(findAvailableSlots);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null);
  const [hasGcal, setHasGcal] = useState<boolean | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await find({
        data: {
          durationMinutes: Math.max(15, Math.min(8 * 60, durationMinutes || 60)),
          daysAhead: 30,
          leadHours: 24,
          maxResults: 5,
        },
      });
      setSlots(res.slots);
      setHasGcal(res.hasGoogleCalendar);
      if (res.slots.length === 0) {
        toast.info("Aucun créneau libre trouvé sur 30 jours.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur recherche créneaux");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Search className="h-4 w-4" />
          Créneaux disponibles
        </div>
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
          {triggerLabel ?? "🔍 Trouver des créneaux disponibles"}
        </Button>
      </div>

      {hasGcal === false && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          Aucun calendrier Google connecté — les créneaux ne tiennent compte que de vos réunions internes.
        </p>
      )}

      {slots && slots.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {slots.map((s) => {
            const start = new Date(s.startAt);
            const end = new Date(s.endAt);
            const selected = isSelected?.(s) ?? false;
            return (
              <Card
                key={s.startAt}
                className={cn(
                  "p-3 cursor-pointer hover:border-primary transition-colors",
                  selected && "border-primary bg-primary/5",
                )}
                onClick={() => onPick({ startAt: s.startAt, endAt: s.endAt })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">
                      {format(start, "EEE d MMM", { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(start, "HH:mm")} – {format(end, "HH:mm")}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className="text-[10px] gap-1 px-1.5">
                      {s.period === "morning" ? <Sun className="h-3 w-3" /> : <Sunset className="h-3 w-3" />}
                      {s.period === "morning" ? "Matin" : "Après-midi"}
                    </Badge>
                    <Badge
                      variant={s.ideal ? "default" : "secondary"}
                      className="text-[10px] gap-1 px-1.5"
                    >
                      {s.ideal ? <Sparkles className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                      {s.ideal ? "Idéal" : "Disponible"}
                    </Badge>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {slots && slots.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun créneau libre trouvé.</p>
      )}
    </div>
  );
}
