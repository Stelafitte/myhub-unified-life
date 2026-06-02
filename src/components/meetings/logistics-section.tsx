import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Package } from "lucide-react";
import { QuorumBadge } from "./quorum-badge";

type Preset = { id: string; label: string; icon: string | null };

export function LogisticsSection({
  userId,
  room,
  quorumMinimum,
  equipment,
  acceptedCount,
  onChange,
}: {
  userId: string;
  room: string;
  quorumMinimum: number | null;
  equipment: string[];
  acceptedCount: number;
  onChange: (patch: {
    room?: string;
    quorum_minimum?: number | null;
    equipment?: string[];
  }) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [recentRooms, setRecentRooms] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase
          .from("meeting_equipment_presets")
          .select("id, label, icon")
          .eq("user_id", userId)
          .order("position", { ascending: true }),
        supabase
          .from("meetings")
          .select("room")
          .eq("user_id", userId)
          .not("room", "is", null)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setPresets((p ?? []) as Preset[]);
      const unique = Array.from(
        new Set(((r ?? []) as { room: string | null }[]).map((x) => x.room ?? "").filter(Boolean))
      ).slice(0, 6);
      setRecentRooms(unique);
    })();
  }, [userId]);

  function toggleEquipment(label: string) {
    const next = equipment.includes(label)
      ? equipment.filter((x) => x !== label)
      : [...equipment, label];
    onChange({ equipment: next });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Logistique
          </CardTitle>
          <QuorumBadge acceptedCount={acceptedCount} minimum={quorumMinimum} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="m-room">Salle</Label>
            <Input
              id="m-room"
              list="room-suggestions"
              value={room}
              onChange={(e) => onChange({ room: e.target.value })}
              placeholder="ex. Salle Curie, Amphi A…"
            />
            {recentRooms.length > 0 && (
              <datalist id="room-suggestions">
                {recentRooms.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-quorum" className="flex items-center gap-1">
              <Users className="h-3 w-3" /> Quorum minimum (0 = désactivé)
            </Label>
            <Input
              id="m-quorum"
              type="number"
              min={0}
              max={500}
              value={quorumMinimum ?? 0}
              onChange={(e) => {
                const n = parseInt(e.target.value || "0", 10);
                onChange({ quorum_minimum: n > 0 ? n : null });
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            <Package className="h-3 w-3" /> Matériel requis
          </Label>
          {presets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucun matériel configuré. Ajoutez vos équipements dans Paramètres → Réunions.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {presets.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-sm rounded-md border px-3 py-1.5 cursor-pointer hover:bg-accent"
                >
                  <Checkbox
                    checked={equipment.includes(p.label)}
                    onCheckedChange={() => toggleEquipment(p.label)}
                  />
                  {p.icon && <span>{p.icon}</span>}
                  {p.label}
                </label>
              ))}
            </div>
          )}
          {equipment.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {equipment.map((e) => (
                <Badge key={e} variant="secondary">
                  {e}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
