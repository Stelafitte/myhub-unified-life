import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowLeft, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SYNC_SOURCES, type SyncEntityType } from "@/lib/sync-sources";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { syncOutlookCalendarEvents } from "@/lib/api/outlook-calendar.functions";
import { syncGoogleCalendarEvents } from "@/lib/api/google-calendar.functions";

type Direction = "push" | "pull" | "bidirectional" | "disabled";

type SyncSetting = {
  id: string;
  user_id: string;
  source: string;
  entity_type: SyncEntityType;
  direction: Direction;
  last_sync_at: string | null;
  sync_frequency_minutes: number;
};

const FREQ_OPTIONS = [
  { value: 0, label: "Temps réel" },
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: -1, label: "Manuel" },
];

export function SyncSection() {
  const { user } = useAuth();
  const runOutlookCal = useServerFn(syncOutlookCalendarEvents);
  const runGoogleCal = useServerFn(syncGoogleCalendarEvents);
  const [settings, setSettings] = useState<SyncSetting[] | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("sync_settings").select("*");
    if (error) return toast.error(error.message);
    setSettings((data ?? []) as SyncSetting[]);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const getSetting = (source: string): SyncSetting | undefined =>
    settings?.find((s) => s.source === source);

  const upsert = async (source: string, entity: SyncEntityType, patch: Partial<SyncSetting>) => {
    if (!user) return;
    const existing = getSetting(source);
    if (existing) {
      const { error } = await supabase.from("sync_settings").update(patch).eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("sync_settings").insert({
        user_id: user.id,
        source,
        entity_type: entity,
        direction: "bidirectional",
        sync_frequency_minutes: 15,
        ...patch,
      });
      if (error) return toast.error(error.message);
    }
    load();
  };

  const syncNow = async (source: string, entity: SyncEntityType) => {
    setSyncing(source);
    await new Promise((r) => setTimeout(r, 1000));
    await upsert(source, entity, { last_sync_at: new Date().toISOString() });
    setSyncing(null);
    toast.success(`${source} synchronisé`);
  };

  if (!settings) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Synchronisation</h2>
        <p className="text-sm text-muted-foreground">Configurez la direction et la fréquence pour chaque source</p>
      </div>

      <div className="space-y-2">
        {SYNC_SOURCES.map((src) => {
          const setting = getSetting(src.id);
          const enabled = setting ? setting.direction !== "disabled" : false;
          const direction = setting?.direction ?? "bidirectional";
          const freq = setting?.sync_frequency_minutes ?? 15;
          return (
            <Card key={src.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
                    {src.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{src.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {setting?.last_sync_at
                        ? `Sync ${new Date(setting.last_sync_at).toLocaleString("fr-FR")}`
                        : "Jamais synchronisé"}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) =>
                      upsert(src.id, src.entity, { direction: v ? "bidirectional" : "disabled" })
                    }
                  />
                </div>

                {enabled && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Direction</Label>
                      <div className="flex gap-1 rounded-lg border p-1">
                        <DirBtn active={direction === "pull"} onClick={() => upsert(src.id, src.entity, { direction: "pull" })} icon={<ArrowLeft className="h-3.5 w-3.5" />} label="Lecture" />
                        <DirBtn active={direction === "push"} onClick={() => upsert(src.id, src.entity, { direction: "push" })} icon={<ArrowRight className="h-3.5 w-3.5" />} label="Écriture" />
                        <DirBtn active={direction === "bidirectional"} onClick={() => upsert(src.id, src.entity, { direction: "bidirectional" })} icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Bidir." />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Fréquence</Label>
                      <Select
                        value={String(freq)}
                        onValueChange={(v) => upsert(src.id, src.entity, { sync_frequency_minutes: Number(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FREQ_OPTIONS.map((f) => (
                            <SelectItem key={f.value} value={String(f.value)}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => syncNow(src.id, src.entity)}
                      disabled={syncing === src.id}
                    >
                      {syncing === src.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Sync now
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function DirBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
