import { useEffect, useState } from "react";
import { Download, Trash2, Moon, Sun, Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Prefs = {
  language: "fr" | "en";
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  notifEmails: boolean;
  notifTasks: boolean;
  notifCalendar: boolean;
  offlineCache: boolean;
  calendarStartHour: number;
  calendarEndHour: number;
};

const DEFAULT_PREFS: Prefs = {
  language: "fr",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dateFormat: "DD/MM/YYYY",
  notifEmails: true,
  notifTasks: true,
  notifCalendar: true,
  offlineCache: true,
  calendarStartHour: 6,
  calendarEndHour: 24,
};

const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

export function PreferencesSection() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    const raw = localStorage.getItem("myhub-prefs");
    if (raw) {
      try {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem("myhub-prefs", JSON.stringify(next));
    window.dispatchEvent(new Event("myhub-prefs-changed"));
  };

  const exportAll = async () => {
    if (!user) return;
    toast.loading("Préparation de l'export…", { id: "export" });
    const [accounts, emails, tasks, events, contacts, settings] = await Promise.all([
      supabase.from("accounts").select("*"),
      supabase.from("emails").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("calendar_events").select("*"),
      supabase.from("contacts").select("*"),
      supabase.from("sync_settings").select("*"),
    ]);
    const payload = {
      exported_at: new Date().toISOString(),
      user_id: user.id,
      preferences: prefs,
      accounts: accounts.data ?? [],
      emails: emails.data ?? [],
      tasks: tasks.data ?? [],
      calendar_events: events.data ?? [],
      contacts: contacts.data ?? [],
      sync_settings: settings.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `myhub-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export téléchargé", { id: "export" });
  };

  const purgeCache = async () => {
    if (!confirm("Vider le cache local ? Vous devrez vous reconnecter.")) return;
    localStorage.clear();
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    toast.success("Cache vidé");
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Préférences</h2>
        <p className="text-sm text-muted-foreground">Personnalisez votre expérience</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apparence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Thème</Label>
            <div className="flex gap-2">
              <ThemeBtn active={theme === "light"} onClick={() => theme !== "light" && toggle()} icon={<Sun className="h-4 w-4" />} label="Clair" />
              <ThemeBtn active={theme === "dark"} onClick={() => theme !== "dark" && toggle()} icon={<Moon className="h-4 w-4" />} label="Sombre" />
              <ThemeBtn active={false} onClick={() => toast.info("Mode auto bientôt disponible")} icon={<Monitor className="h-4 w-4" />} label="Auto" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Régionalisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label="Langue">
            <Select value={prefs.language} onValueChange={(v) => update({ language: v as Prefs["language"] })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Fuseau horaire">
            <Select value={prefs.timezone} onValueChange={(v) => update({ timezone: v })}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Format de date">
            <Select value={prefs.dateFormat} onValueChange={(v) => update({ dateFormat: v as Prefs["dateFormat"] })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label="Heure de début">
            <Select
              value={String(prefs.calendarStartHour)}
              onValueChange={(v) => {
                const start = Number(v);
                const end = prefs.calendarEndHour <= start ? Math.min(24, start + 1) : prefs.calendarEndHour;
                update({ calendarStartHour: start, calendarEndHour: end });
              }}
            >
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Heure de fin">
            <Select
              value={String(prefs.calendarEndHour)}
              onValueChange={(v) => update({ calendarEndHour: Number(v) })}
            >
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => i + 1)
                  .filter((h) => h > prefs.calendarStartHour)
                  .map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h === 24 ? "Minuit (24:00)" : `${String(h).padStart(2, "0")}:00`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow label="Nouveaux emails" value={prefs.notifEmails} onChange={(v) => update({ notifEmails: v })} />
          <ToggleRow label="Échéances de tâches" value={prefs.notifTasks} onChange={(v) => update({ notifTasks: v })} />
          <ToggleRow label="Rappels d'agenda" value={prefs.notifCalendar} onChange={(v) => update({ notifCalendar: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mode offline</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Activer le cache local (PWA)"
            value={prefs.offlineCache}
            onChange={(v) => update({ offlineCache: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Données</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportAll}>
            <Download className="mr-2 h-4 w-4" /> Export JSON complet
          </Button>
          <Button variant="outline" onClick={purgeCache}>
            <Trash2 className="mr-2 h-4 w-4" /> Purger le cache
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function ThemeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-lg border p-3 text-sm transition",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
