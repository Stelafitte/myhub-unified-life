import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  listGoogleCalendarConnections,
  listGoogleCalendarsForConnection,
  addGoogleCalendarFromExisting,
  updateGoogleCalendarConnection,
  deleteGoogleCalendarConnection,
} from "@/lib/api/google-calendar.functions";
import { confirmDialog } from "@/lib/confirm-dialog";

export type AgendaConnection = {
  id: string;
  label: string;
  google_email: string | null;
  calendar_id: string;
  category: "pro" | "perso";
  color: string | null;
  sync_direction: string;
  is_active: boolean;
};

const HIDDEN_KEY = "myhub.calendar.hiddenConnections.v1";

export function getHiddenConnections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function setHiddenConnections(s: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
    window.dispatchEvent(new Event("myhub-agenda-visibility-changed"));
  } catch {}
}

export function useHiddenConnections(): Set<string> {
  const [v, setV] = useState<Set<string>>(getHiddenConnections);
  useEffect(() => {
    const h = () => setV(getHiddenConnections());
    window.addEventListener("storage", h);
    window.addEventListener("myhub-agenda-visibility-changed", h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener("myhub-agenda-visibility-changed", h);
    };
  }, []);
  return v;
}

export function GoogleAgendasPanel({ onChanged }: { onChanged?: () => void }) {
  const listConns = useServerFn(listGoogleCalendarConnections);
  const listCals = useServerFn(listGoogleCalendarsForConnection);
  const addCal = useServerFn(addGoogleCalendarFromExisting);
  const updateConn = useServerFn(updateGoogleCalendarConnection);
  const deleteConn = useServerFn(deleteGoogleCalendarConnection);

  const [conns, setConns] = useState<AgendaConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [hidden, setHiddenState] = useState<Set<string>>(getHiddenConnections);

  const [addOpen, setAddOpen] = useState(false);
  const [availableCals, setAvailableCals] = useState<
    { id: string; summary: string; primary: boolean; backgroundColor: string | null }[]
  >([]);
  const [loadingCals, setLoadingCals] = useState(false);
  const [pickedCalId, setPickedCalId] = useState<string>("");
  const [newLabel, setNewLabel] = useState("Agenda perso");
  const [newCategory, setNewCategory] = useState<"pro" | "perso">("perso");
  const [newColor, setNewColor] = useState("#f97316");
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listConns();
      setConns(data as AgendaConnection[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggleVisibility = (id: string, visible: boolean) => {
    const next = new Set(hidden);
    if (visible) next.delete(id);
    else next.add(id);
    setHiddenState(next);
    setHiddenConnections(next);
  };

  const openAdd = async () => {
    if (conns.length === 0) {
      toast.error("Connectez d'abord un compte Google.");
      return;
    }
    setAddOpen(true);
    setLoadingCals(true);
    try {
      const cals = await listCals({ data: { connectionId: conns[0].id } });
      const existing = new Set(conns.map((c) => c.calendar_id));
      const filtered = (cals as typeof availableCals).filter((c) => !existing.has(c.id));
      setAvailableCals(filtered);
      if (filtered.length > 0) {
        const perso = filtered.find((c) =>
          /perso|non[\s_-]?pro|personnel|personal/i.test(c.summary),
        );
        setPickedCalId(perso?.id ?? filtered[0].id);
        if (perso) setNewLabel(perso.summary);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Impossible de lister les agendas : ${msg}`);
    } finally {
      setLoadingCals(false);
    }
  };

  const submitAdd = async () => {
    if (!pickedCalId) return;
    setSaving(true);
    try {
      await addCal({
        data: {
          sourceConnectionId: conns[0].id,
          calendarId: pickedCalId,
          label: newLabel.trim() || "Agenda",
          category: newCategory,
          color: newColor,
          syncDirection: "bidirectional",
        },
      });
      toast.success("Agenda ajouté. Lancez la synchronisation pour voir les événements.");
      setAddOpen(false);
      await refresh();
      onChanged?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const onCategoryChange = async (id: string, cat: "pro" | "perso") => {
    try {
      const color = cat === "perso" ? "#f97316" : "#6366f1";
      await updateConn({ data: { id, category: cat, color } });
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onRemove = async (id: string) => {
    if (!await confirmDialog("Retirer cet agenda ? Les événements synchronisés seront supprimés localement.")) return;
    try {
      await deleteConn({ data: { id } });
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agendas Google
        </div>
        {conns.length > 0 && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={openAdd}>
            <Plus className="h-3 w-3" /> Ajouter
          </Button>
        )}
      </div>

      {loading && conns.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
        </div>
      ) : conns.length === 0 ? (
        <div className="text-xs text-muted-foreground">Aucun agenda Google connecté.</div>
      ) : (
        <ul className="space-y-1.5">
          {conns.map((c) => {
            const visible = !hidden.has(c.id);
            const color = c.color ?? (c.category === "perso" ? "#f97316" : "#6366f1");
            return (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card/30 p-2"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{c.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {c.google_email ?? "—"}
                  </div>
                </div>
                <Select
                  value={c.category}
                  onValueChange={(v) => onCategoryChange(c.id, v as "pro" | "perso")}
                >
                  <SelectTrigger className="h-6 w-[68px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="perso">Perso</SelectItem>
                  </SelectContent>
                </Select>
                <Switch
                  checked={visible}
                  onCheckedChange={(v) => toggleVisibility(c.id, v)}
                  aria-label={visible ? "Masquer" : "Afficher"}
                />
                {conns.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => onRemove(c.id)}
                    aria-label="Retirer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un agenda Google</DialogTitle>
            <DialogDescription>
              Choisissez un agenda du compte déjà connecté à ajouter à la vue.
            </DialogDescription>
          </DialogHeader>

          {loadingCals ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des agendas…
            </div>
          ) : availableCals.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">
              Aucun agenda supplémentaire disponible dans ce compte.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cal-pick">Agenda Google</Label>
                <Select value={pickedCalId} onValueChange={setPickedCalId}>
                  <SelectTrigger id="cal-pick">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCals.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.summary}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cal-label">Nom affiché</Label>
                <Input
                  id="cal-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Catégorie</Label>
                  <Select value={newCategory} onValueChange={(v) => {
                    const cat = v as "pro" | "perso";
                    setNewCategory(cat);
                    setNewColor(cat === "perso" ? "#f97316" : "#6366f1");
                  }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="perso">Perso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-color">Couleur</Label>
                  <Input
                    id="cal-color"
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-10 p-1"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button onClick={submitAdd} disabled={!pickedCalId || saving || loadingCals}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
