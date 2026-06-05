import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Loader2, Sun, Sunset, Sparkles, CheckCircle2, AlertCircle, Wand2, Check } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { findAvailableSlots, aiProposeSlots, type AvailableSlot, type AiProposedSlot } from "@/lib/api/meetings.functions";
import { cn } from "@/lib/utils";

type Props = {
  /** Duration to look for, in minutes. */
  durationMinutes: number;
  /** Search horizon in days (default 30). */
  daysAhead?: number;
  /** Called when the user picks a slot. ISO strings. */
  onPick: (slot: { startAt: string; endAt: string }) => void;
  /** Optional: allow picking multiple slots (returns true to keep selected style) */
  isSelected?: (slot: AvailableSlot) => boolean;
  /** Compact label for the trigger button. */
  triggerLabel?: string;
};

export function SlotFinder({ durationMinutes, daysAhead = 30, onPick, isSelected, triggerLabel }: Props) {
  const find = useServerFn(findAvailableSlots);
  const propose = useServerFn(aiProposeSlots);

  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null);
  const [hasGcal, setHasGcal] = useState<boolean | null>(null);

  // AI proposition dialog state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiConstraints, setAiConstraints] = useState("");
  const [aiHistory, setAiHistory] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSlots, setAiSlots] = useState<AiProposedSlot[] | null>(null);
  const [aiSelected, setAiSelected] = useState<Set<string>>(new Set());

  function resetAi() {
    setAiConstraints("");
    setAiHistory([]);
    setAiSlots(null);
    setAiSelected(new Set());
  }

  async function run() {
    setLoading(true);
    try {
      const res = await find({
        data: {
          durationMinutes: Math.max(15, Math.min(8 * 60, durationMinutes || 60)),
          daysAhead,
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

  async function runAi() {
    const fragment = aiConstraints.trim();
    if (!fragment && aiHistory.length === 0) {
      toast.error("Décrivez vos contraintes pour la proposition IA.");
      return;
    }
    const nextHistory = fragment ? [...aiHistory, fragment] : aiHistory;
    const combined = nextHistory.join("\n");
    setAiLoading(true);
    try {
      const res = await propose({
        data: {
          constraints: combined,
          durationMinutes: Math.max(15, Math.min(8 * 60, durationMinutes || 60)),
          daysAhead,
          leadHours: 24,
          maxResults: 8,
        },
      });
      setHasGcal(res.hasGoogleCalendar);
      setAiSlots(res.slots);
      setAiSelected(new Set());
      setAiHistory(nextHistory);
      setAiConstraints("");
      if (res.slots.length === 0) {
        toast.info("L'IA n'a trouvé aucun créneau correspondant à vos contraintes.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur proposition IA");
    } finally {
      setAiLoading(false);
    }
  }

  function toggleAiSlot(key: string) {
    setAiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function confirmAiSelection() {
    if (!aiSlots || aiSelected.size === 0) {
      toast.error("Sélectionnez au moins un créneau.");
      return;
    }
    const picked = aiSlots.filter((s) => aiSelected.has(s.startAt));
    picked.forEach((s) => onPick({ startAt: s.startAt, endAt: s.endAt }));
    toast.success(picked.length > 1 ? `${picked.length} créneaux ajoutés` : "Créneau sélectionné");
    setAiOpen(false);
    resetAi();
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Search className="h-4 w-4" />
          Créneaux disponibles
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
            {triggerLabel ?? "🔍 Trouver des créneaux"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setAiOpen(true); setAiSlots(null); }}
          >
            <Wand2 className="h-4 w-4 mr-1" />
            ✨ Proposition IA
          </Button>
        </div>
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

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" /> Proposition IA de créneaux
            </DialogTitle>
            <DialogDescription>
              L'IA combine vos disponibilités d'agenda avec vos contraintes pour proposer les meilleurs créneaux.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="ai-constraints">Contraintes et disponibilités</Label>
              <Textarea
                id="ai-constraints"
                ref={aiConstraintsRef}
                rows={4}
                placeholder="Ex : dispo les après-midis de 15h à 18h, pas le lundi, éviter avant 9h, idéalement mardi ou jeudi…"
                defaultValue=""
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Durée recherchée : {Math.max(15, Math.min(8 * 60, durationMinutes || 60))} min. L'IA ne propose que des créneaux libres dans votre agenda qui respectent strictement vos disponibilités.
              </p>
            </div>

            {aiSlots && aiSlots.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Propositions :</div>
                <div className="grid grid-cols-1 gap-2">
                  {aiSlots.map((s) => {
                    const start = new Date(s.startAt);
                    const end = new Date(s.endAt);
                    return (
                      <Card
                        key={s.startAt}
                        className="p-3 cursor-pointer hover:border-primary transition-colors"
                        onClick={() => {
                          onPick({ startAt: s.startAt, endAt: s.endAt });
                          setAiOpen(false);
                          toast.success("Créneau sélectionné");
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">
                              {format(start, "EEEE d MMMM", { locale: fr })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(start, "HH:mm")} – {format(end, "HH:mm")}
                            </div>
                            {s.reason && (
                              <div className="mt-1 text-xs text-muted-foreground italic">
                                {s.reason}
                              </div>
                            )}
                          </div>
                          <Sparkles className="h-4 w-4 text-primary shrink-0" />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {aiSlots && aiSlots.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucun créneau ne correspond à vos contraintes. Essayez d'assouplir vos critères.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Fermer</Button>
            <Button onClick={runAi} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              {aiLoading ? "Analyse…" : "Proposer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
