import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Save, Plus, Trash2, NotebookPen } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listOneNoteNotebooks,
  listOneNoteSections,
  testOneNoteConnection,
} from "@/lib/api/onenote.functions";

type Settings = {
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  min_lead_hours: number;
  default_provider: string;
  default_duration_min: number;
  email_template_invite: string;
  email_template_confirm: string;
  rsvp_reminders_enabled: boolean;
  rsvp_reminder_hours_before: number;
  onenote_enabled: boolean;
  onenote_notebook_id: string | null;
  onenote_section_id: string | null;
  onenote_auto_sync: boolean;
};

const DEFAULTS: Settings = {
  work_start_time: "08:00",
  work_end_time: "19:00",
  work_days: [1, 2, 3, 4, 5],
  min_lead_hours: 24,
  default_provider: "meet",
  default_duration_min: 30,
  email_template_invite:
    'Bonjour,\n\nVous êtes invité(e) à la réunion "{{title}}" le {{date}}.\n\nLien : {{link}}\n\nCordialement,\n{{organizer}}',
  email_template_confirm:
    'Bonjour,\n\nLa réunion "{{title}}" est confirmée le {{date}}.\n\nLien : {{link}}\n\nCordialement,\n{{organizer}}',
  rsvp_reminders_enabled: true,
  rsvp_reminder_hours_before: 24,
  onenote_enabled: false,
  onenote_notebook_id: null,
  onenote_section_id: null,
  onenote_auto_sync: false,
};

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" },
];

type Preset = { id: string; label: string; icon: string | null; position: number };

export function MeetingsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPreset, setNewPreset] = useState({ label: "", icon: "📽️" });

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data }, { data: pr }] = await Promise.all([
        supabase.from("meeting_settings").select("*").eq("user_id", u.user.id).maybeSingle(),
        supabase
          .from("meeting_equipment_presets")
          .select("id, label, icon, position")
          .eq("user_id", u.user.id)
          .order("position", { ascending: true }),
      ]);
      if (data) {
        setS({
          work_start_time: (data.work_start_time as string).slice(0, 5),
          work_end_time: (data.work_end_time as string).slice(0, 5),
          work_days: data.work_days ?? DEFAULTS.work_days,
          min_lead_hours: data.min_lead_hours,
          default_provider: data.default_provider,
          default_duration_min: data.default_duration_min,
          email_template_invite: data.email_template_invite,
          email_template_confirm: data.email_template_confirm,
          rsvp_reminders_enabled:
            (data as { rsvp_reminders_enabled?: boolean }).rsvp_reminders_enabled ?? true,
          rsvp_reminder_hours_before:
            (data as { rsvp_reminder_hours_before?: number }).rsvp_reminder_hours_before ?? 24,
          onenote_enabled:
            (data as { onenote_enabled?: boolean }).onenote_enabled ?? false,
          onenote_notebook_id:
            (data as { onenote_notebook_id?: string | null }).onenote_notebook_id ?? null,
          onenote_section_id:
            (data as { onenote_section_id?: string | null }).onenote_section_id ?? null,
          onenote_auto_sync:
            (data as { onenote_auto_sync?: boolean }).onenote_auto_sync ?? false,
        });
      }
      setPresets((pr ?? []) as Preset[]);
      setLoading(false);
    })();
  }, []);

  const toggleDay = (d: number) => {
    setS((p) => ({
      ...p,
      work_days: p.work_days.includes(d)
        ? p.work_days.filter((x) => x !== d)
        : [...p.work_days, d].sort(),
    }));
  };

  const save = async () => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("meeting_settings")
      .upsert({ user_id: u.user.id, ...s }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error("Erreur : " + error.message);
    else toast.success("Paramètres réunions sauvegardés");
  };

  async function addPreset() {
    if (!newPreset.label.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await supabase
      .from("meeting_equipment_presets")
      .insert({
        user_id: u.user.id,
        label: newPreset.label.trim(),
        icon: newPreset.icon || null,
        position: presets.length,
      })
      .select("id, label, icon, position")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setPresets((p) => [...p, data as Preset]);
    setNewPreset({ label: "", icon: "📽️" });
  }

  async function removePreset(id: string) {
    const { error } = await supabase.from("meeting_equipment_presets").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPresets((p) => p.filter((x) => x.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Disponibilités</CardTitle>
          <CardDescription>
            Utilisé pour la recherche automatique de créneaux.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Heure de début</Label>
              <Input
                type="time"
                value={s.work_start_time}
                onChange={(e) => setS({ ...s, work_start_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Heure de fin</Label>
              <Input
                type="time"
                value={s.work_end_time}
                onChange={(e) => setS({ ...s, work_end_time: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Jours ouvrés</Label>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d) => (
                <label key={d.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={s.work_days.includes(d.value)}
                    onCheckedChange={() => toggleDay(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Délai minimum avant une réunion (heures)</Label>
            <Input
              type="number"
              min={0}
              max={168}
              value={s.min_lead_hours}
              onChange={(e) =>
                setS({ ...s, min_lead_hours: parseInt(e.target.value || "0", 10) })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Valeurs par défaut</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fournisseur visio par défaut</Label>
              <Select
                value={s.default_provider}
                onValueChange={(v) => setS({ ...s, default_provider: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meet">Google Meet</SelectItem>
                  <SelectItem value="zoom">Zoom</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                  <SelectItem value="none">Aucun (présentiel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Durée par défaut (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={480}
                step={5}
                value={s.default_duration_min}
                onChange={(e) =>
                  setS({ ...s, default_duration_min: parseInt(e.target.value || "30", 10) })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rappels RSVP</CardTitle>
          <CardDescription>
            Envoi automatique d'un rappel aux participants n'ayant pas encore répondu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="rsvp-enabled">Activer les rappels automatiques</Label>
            <Switch
              id="rsvp-enabled"
              checked={s.rsvp_reminders_enabled}
              onCheckedChange={(v) => setS({ ...s, rsvp_reminders_enabled: v })}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Délai avant la réunion</Label>
              <span className="text-sm text-muted-foreground">
                {s.rsvp_reminder_hours_before} h
              </span>
            </div>
            <Slider
              min={1}
              max={72}
              step={1}
              value={[s.rsvp_reminder_hours_before]}
              onValueChange={([v]) => setS({ ...s, rsvp_reminder_hours_before: v })}
              disabled={!s.rsvp_reminders_enabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matériel disponible</CardTitle>
          <CardDescription>
            Liste personnalisable proposée dans la logistique de chaque réunion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {presets.length > 0 && (
            <div className="space-y-2">
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    {p.icon && <span>{p.icon}</span>}
                    {p.label}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removePreset(p.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <div className="w-16 space-y-1">
              <Label>Icône</Label>
              <Input
                value={newPreset.icon}
                maxLength={2}
                onChange={(e) => setNewPreset({ ...newPreset, icon: e.target.value })}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label>Libellé</Label>
              <Input
                value={newPreset.label}
                placeholder="ex. Vidéoprojecteur"
                onChange={(e) => setNewPreset({ ...newPreset, label: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPreset()}
              />
            </div>
            <Button type="button" onClick={addPreset} disabled={!newPreset.label.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Ajouter
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modèles d'email</CardTitle>
          <CardDescription>
            Variables disponibles : <code>{"{{title}}"}</code>,{" "}
            <code>{"{{date}}"}</code>, <code>{"{{link}}"}</code>,{" "}
            <code>{"{{organizer}}"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Invitation</Label>
            <Textarea
              rows={8}
              value={s.email_template_invite}
              onChange={(e) => setS({ ...s, email_template_invite: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Confirmation</Label>
            <Textarea
              rows={8}
              value={s.email_template_confirm}
              onChange={(e) => setS({ ...s, email_template_confirm: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Sauvegarder
        </Button>
      </div>
    </div>
  );
}
