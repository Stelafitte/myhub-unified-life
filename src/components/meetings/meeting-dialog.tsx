import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { X, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { downloadIcs } from "@/lib/ics";

type Participant = { email: string; name?: string; role: "required" | "optional" };

export type MeetingFormValue = {
  id?: string;
  title: string;
  description: string;
  start_at: string; // datetime-local
  end_at: string;
  location: string;
  is_online: boolean;
  online_link: string;
  online_provider: string;
  organizer_email: string;
  organizer_name: string;
  participants: Participant[];
};

const empty: MeetingFormValue = {
  title: "",
  description: "",
  start_at: "",
  end_at: "",
  location: "",
  is_online: false,
  online_link: "",
  online_provider: "",
  organizer_email: "",
  organizer_name: "",
  participants: [],
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function MeetingDialog({
  open,
  onOpenChange,
  meetingId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meetingId?: string | null;
  initial?: Partial<MeetingFormValue>;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<MeetingFormValue>(empty);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPart, setNewPart] = useState({ email: "", name: "" });

  useEffect(() => {
    if (!open) return;
    if (meetingId) {
      setLoading(true);
      (async () => {
        const [{ data: m }, { data: ps }] = await Promise.all([
          supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle(),
          supabase.from("meeting_participants").select("*").eq("meeting_id", meetingId),
        ]);
        if (m) {
          setForm({
            id: m.id,
            title: m.title ?? "",
            description: m.description ?? "",
            start_at: toLocalInput(m.start_at),
            end_at: toLocalInput(m.end_at),
            location: m.location ?? "",
            is_online: !!m.is_online,
            online_link: m.online_link ?? "",
            online_provider: m.online_provider ?? "",
            organizer_email: m.organizer_email ?? "",
            organizer_name: m.organizer_name ?? "",
            participants:
              (ps ?? [])
                .filter((p) => p.role !== "organizer")
                .map((p) => ({ email: p.email, name: p.name ?? "", role: (p.role as "required" | "optional") ?? "required" })),
          });
        }
        setLoading(false);
      })();
    } else {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      setForm({
        ...empty,
        ...initial,
        start_at: initial?.start_at ?? toLocalInput(start.toISOString()),
        end_at: initial?.end_at ?? toLocalInput(end.toISOString()),
        organizer_email: initial?.organizer_email ?? user?.email ?? "",
        organizer_name: initial?.organizer_name ?? user?.user_metadata?.display_name ?? "",
      });
    }
  }, [open, meetingId, user, initial]);

  function addPart() {
    const email = newPart.email.trim();
    if (!email) return;
    if (form.participants.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
      toast.error("Participant déjà ajouté");
      return;
    }
    setForm((f) => ({ ...f, participants: [...f.participants, { email, name: newPart.name.trim(), role: "required" }] }));
    setNewPart({ email: "", name: "" });
  }

  function removePart(email: string) {
    setForm((f) => ({ ...f, participants: f.participants.filter((p) => p.email !== email) }));
  }

  async function save(): Promise<string | null> {
    if (!user) return null;
    if (!form.title.trim()) {
      toast.error("Titre requis");
      return null;
    }
    if (!form.start_at || !form.end_at) {
      toast.error("Dates requises");
      return null;
    }
    if (new Date(form.end_at) <= new Date(form.start_at)) {
      toast.error("La fin doit être après le début");
      return null;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        start_at: fromLocalInput(form.start_at),
        end_at: fromLocalInput(form.end_at),
        location: form.location.trim() || null,
        is_online: form.is_online,
        online_link: form.is_online ? form.online_link.trim() || null : null,
        online_provider: form.is_online ? form.online_provider.trim() || null : null,
        organizer_email: form.organizer_email.trim() || null,
        organizer_name: form.organizer_name.trim() || null,
      };
      let id = form.id;
      if (id) {
        const { error } = await supabase.from("meetings").update(payload).eq("id", id);
        if (error) throw error;
        await supabase.from("meeting_participants").delete().eq("meeting_id", id);
      } else {
        const { data, error } = await supabase.from("meetings").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      // organizer participant
      const rows = [
        {
          meeting_id: id!,
          user_id: user.id,
          email: payload.organizer_email ?? user.email ?? "",
          name: payload.organizer_name,
          role: "organizer",
          rsvp_status: "accepted",
        },
        ...form.participants.map((p) => ({
          meeting_id: id!,
          user_id: user.id,
          email: p.email,
          name: p.name || null,
          role: p.role,
          rsvp_status: "pending",
        })),
      ].filter((r) => r.email);
      if (rows.length) {
        const { error } = await supabase.from("meeting_participants").insert(rows);
        if (error) throw error;
      }
      toast.success(form.id ? "Réunion mise à jour" : "Réunion créée");
      onSaved?.();
      onOpenChange(false);
      return id!;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndDownload() {
    const id = await save();
    if (!id) return;
    downloadIcs({
      uid: `${id}@myhubpro`,
      title: form.title,
      description: form.description,
      location: form.is_online ? form.online_link || form.location : form.location,
      startAt: new Date(fromLocalInput(form.start_at)),
      endAt: new Date(fromLocalInput(form.end_at)),
      organizer: form.organizer_email ? { email: form.organizer_email, name: form.organizer_name } : null,
      participants: form.participants,
      url: form.is_online ? form.online_link || null : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Modifier la réunion" : "Nouvelle réunion"}</DialogTitle>
          <DialogDescription>
            Renseignez les informations puis téléchargez l'invitation .ics à joindre à vos emails.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Chargement…</div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="m-title">Titre *</Label>
              <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-start">Début *</Label>
                <Input id="m-start" type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="m-end">Fin *</Label>
                <Input id="m-end" type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="m-loc">Lieu</Label>
              <Input id="m-loc" placeholder="Salle, adresse…" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="m-online" className="cursor-pointer">Visioconférence</Label>
                <p className="text-xs text-muted-foreground">Lien à coller manuellement (Zoom, Teams, Meet…)</p>
              </div>
              <Switch id="m-online" checked={form.is_online} onCheckedChange={(v) => setForm({ ...form, is_online: v })} />
            </div>
            {form.is_online && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="m-link">Lien de la visio</Label>
                  <Input id="m-link" placeholder="https://…" value={form.online_link} onChange={(e) => setForm({ ...form, online_link: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="m-prov">Plateforme</Label>
                  <Input id="m-prov" placeholder="Zoom, Teams…" value={form.online_provider} onChange={(e) => setForm({ ...form, online_provider: e.target.value })} />
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="m-desc">Description / Ordre du jour</Label>
              <Textarea id="m-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Participants</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="email@exemple.com"
                  value={newPart.email}
                  onChange={(e) => setNewPart({ ...newPart, email: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPart())}
                />
                <Input
                  placeholder="Nom (optionnel)"
                  value={newPart.name}
                  onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPart())}
                />
                <Button type="button" variant="outline" onClick={addPart}>Ajouter</Button>
              </div>
              {form.participants.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.participants.map((p) => (
                    <Badge key={p.email} variant="secondary" className="gap-1 pr-1">
                      {p.name ? `${p.name} <${p.email}>` : p.email}
                      <button type="button" onClick={() => removePart(p.email)} className="hover:bg-muted rounded-sm">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {form.id && (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={async () => {
                if (!confirm("Supprimer cette réunion ?")) return;
                await supabase.from("meeting_participants").delete().eq("meeting_id", form.id!);
                await supabase.from("meeting_tasks").delete().eq("meeting_id", form.id!);
                await supabase.from("meetings").delete().eq("id", form.id!);
                toast.success("Réunion supprimée");
                onSaved?.();
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Supprimer
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
          <Button variant="outline" onClick={saveAndDownload} disabled={saving}>
            <Download className="h-4 w-4 mr-1" /> Enregistrer & .ics
          </Button>
          <Button onClick={save} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
