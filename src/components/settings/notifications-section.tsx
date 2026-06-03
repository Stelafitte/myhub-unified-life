import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Prefs = {
  browserEnabled: boolean;
  newEmails: boolean;
  dueTasks: boolean;
  meetings: boolean;
  syncFailed: boolean;
  quietStart: string;
  quietEnd: string;
  badgeInbox: boolean;
  badgeTasks: boolean;
  badgeMeetings: boolean;
  badgeDocuments: boolean;
};

const DEFAULT: Prefs = {
  browserEnabled: false,
  newEmails: true,
  dueTasks: true,
  meetings: true,
  syncFailed: true,
  quietStart: "22:00",
  quietEnd: "07:00",
  badgeInbox: true,
  badgeTasks: true,
  badgeMeetings: true,
  badgeDocuments: false,
};

export function NotificationsSection() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);

  useEffect(() => {
    const raw = localStorage.getItem("myhub-notifications");
    if (raw) {
      try {
        setPrefs({ ...DEFAULT, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem("myhub-notifications", JSON.stringify(next));
    window.dispatchEvent(new Event("myhub-notifications-changed"));
  };

  const toggleBrowser = async (v: boolean) => {
    if (v && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Permission refusée par le navigateur");
        return;
      }
    }
    update({ browserEnabled: v });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">Alertes navigateur, heures de silence et pastilles</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Général
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Notifications navigateur" value={prefs.browserEnabled} onChange={toggleBrowser} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Par type</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Nouveaux emails" value={prefs.newEmails} onChange={(v) => update({ newEmails: v })} />
          <Toggle label="Tâches échues" value={prefs.dueTasks} onChange={(v) => update({ dueTasks: v })} />
          <Toggle label="Réunions à venir" value={prefs.meetings} onChange={(v) => update({ meetings: v })} />
          <Toggle label="Synchronisation échouée" value={prefs.syncFailed} onChange={(v) => update({ syncFailed: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Heures de silence</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Début</Label>
            <Input
              type="time"
              value={prefs.quietStart}
              onChange={(e) => update({ quietStart: e.target.value })}
              className="w-32"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fin</Label>
            <Input
              type="time"
              value={prefs.quietEnd}
              onChange={(e) => update({ quietEnd: e.target.value })}
              className="w-32"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => update({ quietStart: "00:00", quietEnd: "00:00" })}
          >
            Désactiver
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pastilles sidebar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Boîte de réception" value={prefs.badgeInbox} onChange={(v) => update({ badgeInbox: v })} />
          <Toggle label="Tâches" value={prefs.badgeTasks} onChange={(v) => update({ badgeTasks: v })} />
          <Toggle label="Réunions" value={prefs.badgeMeetings} onChange={(v) => update({ badgeMeetings: v })} />
          <Toggle label="Documents" value={prefs.badgeDocuments} onChange={(v) => update({ badgeDocuments: v })} />
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
