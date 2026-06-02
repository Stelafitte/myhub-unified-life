import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Download, Trash2, Sparkles, Paperclip, Mail, ListTodo, Upload, FileText, Plus, Vote, Copy, ExternalLink, CheckCircle2, HelpCircle, XCircle, Trophy } from "lucide-react";
import { toast } from "sonner";
import { downloadIcs } from "@/lib/ics";
import {
  sha256,
  storagePath,
  uploadToStorage,
  getSignedUrl,
  removeFromStorage,
  type DocumentRow,
} from "@/lib/documents";
import { formatBytes } from "@/lib/file-icons";
import { cn } from "@/lib/utils";
import { SlotFinder } from "@/components/meetings/slot-finder";

type Provider = "jitsi" | "google_meet" | "zoom" | "teams" | "other";
const PROVIDER_LABEL: Record<Provider, string> = {
  jitsi: "Jitsi (lien auto)",
  google_meet: "Google Meet (coller le lien)",
  zoom: "Zoom (coller le lien)",
  teams: "Microsoft Teams (coller le lien)",
  other: "Autre / lien personnalisé",
};
function generateJitsiLink(): string {
  const slug = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
  return `https://meet.jit.si/MyHub-${slug}`;
}

type Importance = "low" | "normal" | "high" | "critical";
const IMPORTANCE_META: Record<Importance, { label: string; cls: string }> = {
  low: { label: "Faible", cls: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", cls: "bg-secondary text-secondary-foreground" },
  high: { label: "Élevé", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  critical: { label: "Critique", cls: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200" },
};

type Participant = { email: string; name?: string; role: "required" | "optional" };

export type MeetingFormValue = {
  id?: string;
  title: string;
  description: string;
  notes: string;
  importance: Importance;
  start_at: string;
  end_at: string;
  location: string;
  is_online: boolean;
  online_link: string;
  online_provider: Provider | "";
  zoom_password: string;
  organizer_email: string;
  organizer_name: string;
  participants: Participant[];
};

const empty: MeetingFormValue = {
  title: "",
  description: "",
  notes: "",
  importance: "normal",
  start_at: "",
  end_at: "",
  location: "",
  is_online: false,
  online_link: "",
  online_provider: "",
  zoom_password: "",
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
  const [attachments, setAttachments] = useState<DocumentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Poll mode state ---
  const [pollMode, setPollMode] = useState(false);
  const [pollSlots, setPollSlots] = useState<{ startAt: string; endAt: string }[]>([]);
  const [pollDeadline, setPollDeadline] = useState<string>("");
  const [existingPoll, setExistingPoll] = useState<{ id: string; public_token: string } | null>(null);

  async function loadAttachments(id: string) {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("source_type", "meeting")
      .eq("source_id", id)
      .order("created_at", { ascending: false });
    setAttachments((data ?? []) as DocumentRow[]);
  }

  useEffect(() => {
    if (!open) return;
    setAttachments([]);
    setPollSlots([]);
    setPollDeadline("");
    setPollMode(false);
    setExistingPoll(null);
    if (meetingId) {
      setLoading(true);
      (async () => {
        const [{ data: m }, { data: ps }, { data: polls }] = await Promise.all([
          supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle(),
          supabase.from("meeting_participants").select("*").eq("meeting_id", meetingId),
          supabase.from("meeting_polls").select("id, public_token, deadline").eq("meeting_id", meetingId).order("created_at", { ascending: false }).limit(1),
        ]);
        if (m) {
          setForm({
            id: m.id,
            title: m.title ?? "",
            description: m.description ?? "",
            notes: m.notes ?? "",
            importance: ((m as { importance?: string }).importance as Importance) ?? "normal",
            start_at: toLocalInput(m.start_at),
            end_at: toLocalInput(m.end_at),
            location: m.location ?? "",
            is_online: !!m.is_online,
            online_link: m.online_link ?? "",
            online_provider: ((m.online_provider as Provider) ?? "") as Provider | "",
            zoom_password: m.zoom_password ?? "",
            organizer_email: m.organizer_email ?? "",
            organizer_name: m.organizer_name ?? "",
            participants:
              (ps ?? [])
                .filter((p) => p.role !== "organizer")
                .map((p) => ({ email: p.email, name: p.name ?? "", role: (p.role as "required" | "optional") ?? "required" })),
          });
          loadAttachments(meetingId);
          const poll = polls?.[0];
          if (poll) {
            setExistingPoll({ id: poll.id, public_token: poll.public_token });
            setPollMode(true);
            if (poll.deadline) setPollDeadline(toLocalInput(poll.deadline));
            const { data: slots } = await supabase
              .from("meeting_poll_slots")
              .select("start_at, end_at")
              .eq("poll_id", poll.id)
              .order("position", { ascending: true });
            setPollSlots((slots ?? []).map((s) => ({ startAt: s.start_at, endAt: s.end_at })));
          }
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

  function addPollSlot(startAt: string, endAt: string) {
    setPollSlots((s) => {
      if (s.some((x) => x.startAt === startAt)) {
        toast.error("Créneau déjà ajouté");
        return s;
      }
      return [...s, { startAt, endAt }].sort((a, b) => a.startAt.localeCompare(b.startAt));
    });
  }
  function removePollSlot(idx: number) {
    setPollSlots((s) => s.filter((_, i) => i !== idx));
  }
  function addManualPollSlot() {
    const base = pollSlots.length
      ? new Date(pollSlots[pollSlots.length - 1].endAt)
      : new Date(form.start_at ? fromLocalInput(form.start_at) : Date.now());
    const start = new Date(base.getTime() + (pollSlots.length ? 24 * 3600_000 : 0));
    const durationMin = (() => {
      if (!form.start_at || !form.end_at) return 60;
      const ms = new Date(fromLocalInput(form.end_at)).getTime() - new Date(fromLocalInput(form.start_at)).getTime();
      return Math.max(15, Math.round(ms / 60000));
    })();
    const end = new Date(start.getTime() + durationMin * 60_000);
    addPollSlot(start.toISOString(), end.toISOString());
  }

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
    if (pollMode) {
      if (pollSlots.length < 2) {
        toast.error("Ajoutez au moins 2 créneaux au sondage");
        return null;
      }
    } else {
      if (!form.start_at || !form.end_at) {
        toast.error("Dates requises");
        return null;
      }
      if (new Date(form.end_at) <= new Date(form.start_at)) {
        toast.error("La fin doit être après le début");
        return null;
      }
    }
    setSaving(true);
    try {
      // For poll mode the meeting acts as anchor; use the earliest slot as start/end
      const effectiveStart = pollMode ? pollSlots[0].startAt : fromLocalInput(form.start_at);
      const effectiveEnd = pollMode ? pollSlots[0].endAt : fromLocalInput(form.end_at);

      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        importance: form.importance,
        start_at: effectiveStart,
        end_at: effectiveEnd,
        location: form.location.trim() || null,
        is_online: form.is_online,
        online_link: form.is_online ? form.online_link.trim() || null : null,
        online_provider: form.is_online ? form.online_provider || null : null,
        zoom_password: form.is_online && form.online_provider === "zoom" ? form.zoom_password.trim() || null : null,
        organizer_email: form.organizer_email.trim() || null,
        organizer_name: form.organizer_name.trim() || null,
        status: pollMode ? "scheduled" : "scheduled",
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

      // --- Poll persistence ---
      if (pollMode) {
        let pollId = existingPoll?.id ?? null;
        const pollPayload = {
          user_id: user.id,
          meeting_id: id!,
          title: form.title.trim(),
          description: form.description.trim() || null,
          deadline: pollDeadline ? fromLocalInput(pollDeadline) : null,
          status: "open",
        };
        if (pollId) {
          const { error } = await supabase.from("meeting_polls").update(pollPayload).eq("id", pollId);
          if (error) throw error;
          await supabase.from("meeting_poll_slots").delete().eq("poll_id", pollId);
        } else {
          const { data, error } = await supabase
            .from("meeting_polls")
            .insert(pollPayload)
            .select("id, public_token")
            .single();
          if (error) throw error;
          pollId = data.id;
          setExistingPoll({ id: data.id, public_token: data.public_token });
        }
        const slotRows = pollSlots.map((s, i) => ({
          poll_id: pollId!,
          start_at: s.startAt,
          end_at: s.endAt,
          position: i,
        }));
        if (slotRows.length) {
          const { error } = await supabase.from("meeting_poll_slots").insert(slotRows);
          if (error) throw error;
        }
      } else if (existingPoll) {
        // User disabled poll mode: close the existing poll
        await supabase.from("meeting_polls").update({ status: "closed" }).eq("id", existingPoll.id);
      }

      setForm((f) => ({ ...f, id }));
      toast.success(form.id ? "Réunion mise à jour" : pollMode ? "Sondage créé" : "Réunion créée");
      onSaved?.();
      requestAutoSync();
      return id!;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    const id = await save();
    if (id) onOpenChange(false);
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

  // --- Attachments ---
  async function ensureSaved(): Promise<string | null> {
    if (form.id) return form.id;
    return await save();
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!user || files.length === 0) return;
    const id = await ensureSaved();
    if (!id) return;
    setUploading(true);
    try {
      for (const file of files) {
        const docId = crypto.randomUUID();
        const path = storagePath(user.id, "meeting", docId, file.name);
        await uploadToStorage(path, file);
        const checksum = await sha256(file);
        const { error } = await supabase.from("documents").insert({
          id: docId,
          user_id: user.id,
          filename: file.name,
          original_filename: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          storage_path: path,
          source_type: "meeting",
          source_id: id,
          tags: [],
          checksum,
        });
        if (error) throw error;
      }
      await loadAttachments(id);
      toast.success("Fichier(s) ajouté(s)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  }

  async function downloadAttachment(doc: DocumentRow) {
    if (!doc.storage_path) return;
    try {
      const url = await getSignedUrl(doc.storage_path, 60);
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur téléchargement");
    }
  }

  async function deleteAttachment(doc: DocumentRow) {
    if (!confirm(`Supprimer "${doc.filename}" ?`)) return;
    try {
      if (doc.storage_path) await removeFromStorage(doc.storage_path);
      await supabase.from("documents").delete().eq("id", doc.id);
      setAttachments((a) => a.filter((d) => d.id !== doc.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur suppression");
    }
  }

  // --- Quick actions ---
  function sendMailToParticipants() {
    const recipients = form.participants.map((p) => p.email).filter(Boolean);
    if (recipients.length === 0) {
      toast.error("Aucun participant");
      return;
    }
    const dateStr = form.start_at ? new Date(fromLocalInput(form.start_at)).toLocaleString("fr-FR") : "";
    const lines = [
      `Bonjour,`,
      ``,
      `Je vous propose la réunion suivante :`,
      `• ${form.title}`,
      dateStr ? `• Date : ${dateStr}` : "",
      form.location ? `• Lieu : ${form.location}` : "",
      form.is_online && form.online_link ? `• Visio : ${form.online_link}` : "",
      form.description ? `\n${form.description}` : "",
      ``,
      `Cordialement,`,
      form.organizer_name || "",
    ].filter(Boolean).join("\n");
    const subject = encodeURIComponent(`Invitation : ${form.title}`);
    const body = encodeURIComponent(lines);
    window.location.href = `mailto:${recipients.join(",")}?subject=${subject}&body=${body}`;
  }

  async function createLinkedTask() {
    if (!user) return;
    const id = await ensureSaved();
    if (!id) return;
    try {
      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title: `Préparer : ${form.title}`,
          description: form.notes || form.description || null,
          status: "todo",
          priority: form.importance === "critical" || form.importance === "high" ? "high" : "medium",
          due_date: fromLocalInput(form.start_at),
          source_app: "myhubpro",
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("meeting_tasks").insert({
        meeting_id: id,
        task_id: task.id,
        user_id: user.id,
      });
      toast.success("Tâche associée créée");
      requestAutoSync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {form.id ? "Modifier la réunion" : "Nouvelle réunion"}
            <Badge className={cn("ml-2 text-xs", IMPORTANCE_META[form.importance].cls)}>
              {IMPORTANCE_META[form.importance].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Préparez la réunion : notes, participants, pièces jointes, visio, importance…
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Chargement…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div>
                <Label htmlFor="m-title">Titre *</Label>
                <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="m-imp">Importance</Label>
                <Select value={form.importance} onValueChange={(v) => setForm({ ...form, importance: v as Importance })}>
                  <SelectTrigger id="m-imp" className="min-w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(IMPORTANCE_META) as Importance[]).map((k) => (
                      <SelectItem key={k} value={k}>{IMPORTANCE_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Poll mode toggle */}
            <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
              <div>
                <Label htmlFor="m-poll" className="cursor-pointer flex items-center gap-1.5">
                  <Vote className="h-4 w-4" /> Mode sondage de dates
                </Label>
                <p className="text-xs text-muted-foreground">
                  Proposez plusieurs créneaux et laissez les participants voter via un lien public.
                </p>
              </div>
              <Switch id="m-poll" checked={pollMode} onCheckedChange={setPollMode} />
            </div>

            {pollMode ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label>Créneaux proposés ({pollSlots.length})</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addManualPollSlot}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter
                  </Button>
                </div>
                {pollSlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aucun créneau. Utilisez le bouton ci-dessus ou les suggestions ci-dessous.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {pollSlots.map((s, i) => {
                      const sd = new Date(s.startAt);
                      const ed = new Date(s.endAt);
                      return (
                        <li key={i} className="flex items-center gap-2 rounded border bg-card p-2 text-sm">
                          <span className="flex-1">
                            {sd.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}
                            {" · "}
                            {sd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                            {" → "}
                            {ed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <Input
                            type="datetime-local"
                            className="w-[180px] h-8"
                            value={toLocalInput(s.startAt)}
                            onChange={(e) => {
                              const newStart = fromLocalInput(e.target.value);
                              const duration = new Date(s.endAt).getTime() - new Date(s.startAt).getTime();
                              const newEnd = new Date(new Date(newStart).getTime() + duration).toISOString();
                              setPollSlots((arr) => arr.map((x, j) => j === i ? { startAt: newStart, endAt: newEnd } : x));
                            }}
                          />
                          <Button type="button" variant="ghost" size="icon" onClick={() => removePollSlot(i)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div>
                  <Label htmlFor="m-poll-deadline">Date limite de vote (optionnel)</Label>
                  <Input
                    id="m-poll-deadline"
                    type="datetime-local"
                    value={pollDeadline}
                    onChange={(e) => setPollDeadline(e.target.value)}
                  />
                </div>

                <SlotFinder
                  durationMinutes={60}
                  onPick={({ startAt, endAt }) => addPollSlot(startAt, endAt)}
                />

                {existingPoll && (
                  <div className="rounded-md border bg-background p-2 text-xs space-y-1">
                    <div className="font-medium">Lien public du sondage</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate text-muted-foreground">
                        {`${window.location.origin}/poll/${existingPoll.public_token}`}
                      </code>
                      <Button type="button" variant="ghost" size="icon" title="Copier"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/poll/${existingPoll.public_token}`);
                          toast.success("Lien copié");
                        }}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Ouvrir"
                        onClick={() => window.open(`${window.location.origin}/poll/${existingPoll.public_token}`, "_blank")}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
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

                <SlotFinder
                  durationMinutes={(() => {
                    if (!form.start_at || !form.end_at) return 60;
                    const ms = new Date(fromLocalInput(form.end_at)).getTime() - new Date(fromLocalInput(form.start_at)).getTime();
                    const m = Math.round(ms / 60000);
                    return m > 0 ? m : 60;
                  })()}
                  onPick={({ startAt, endAt }) => {
                    setForm((f) => ({
                      ...f,
                      start_at: toLocalInput(startAt),
                      end_at: toLocalInput(endAt),
                    }));
                    toast.success("Créneau sélectionné");
                  }}
                />
              </>
            )}
            <div>
              <Label htmlFor="m-loc">Lieu</Label>
              <Input id="m-loc" placeholder="Salle, adresse…" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="m-online" className="cursor-pointer">Visioconférence</Label>
                <p className="text-xs text-muted-foreground">Choisissez le fournisseur puis collez le lien (ou auto-générez avec Jitsi)</p>
              </div>
              <Switch
                id="m-online"
                checked={form.is_online}
                onCheckedChange={(v) =>
                  setForm({
                    ...form,
                    is_online: v,
                    online_provider: v ? form.online_provider || "jitsi" : "",
                    online_link: v && (form.online_provider || "jitsi") === "jitsi" && !form.online_link ? generateJitsiLink() : form.online_link,
                  })
                }
              />
            </div>
            {form.is_online && (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <Label htmlFor="m-prov">Fournisseur</Label>
                  <Select
                    value={form.online_provider || "jitsi"}
                    onValueChange={(v) => {
                      const prov = v as Provider;
                      setForm({
                        ...form,
                        online_provider: prov,
                        online_link: prov === "jitsi" ? generateJitsiLink() : "",
                        zoom_password: prov === "zoom" ? form.zoom_password : "",
                      });
                    }}
                  >
                    <SelectTrigger id="m-prov"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                        <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="m-link">
                    Lien de la visio {form.online_provider === "jitsi" && <span className="text-xs text-muted-foreground">(généré)</span>}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="m-link"
                      placeholder="https://…"
                      value={form.online_link}
                      onChange={(e) => setForm({ ...form, online_link: e.target.value })}
                    />
                    {form.online_provider === "jitsi" && (
                      <Button type="button" variant="outline" size="icon" onClick={() => setForm({ ...form, online_link: generateJitsiLink() })} title="Régénérer">
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    )}
                    {form.online_link && (
                      <Button type="button" variant="outline" onClick={() => window.open(form.online_link, "_blank")}>
                        Ouvrir
                      </Button>
                    )}
                  </div>
                </div>
                {form.online_provider === "zoom" && (
                  <div>
                    <Label htmlFor="m-zpwd">Mot de passe Zoom (optionnel)</Label>
                    <Input id="m-zpwd" value={form.zoom_password} onChange={(e) => setForm({ ...form, zoom_password: e.target.value })} />
                  </div>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="m-desc">Description / Ordre du jour</Label>
              <Textarea id="m-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div>
              <Label htmlFor="m-notes">Notes de préparation</Label>
              <Textarea
                id="m-notes"
                rows={4}
                placeholder="Points à aborder, questions, éléments à vérifier…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
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

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5"><Paperclip className="h-4 w-4" /> Pièces jointes</Label>
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" /> {uploading ? "Envoi…" : "Ajouter"}
                </Button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
              </div>
              {attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {form.id ? "Aucun fichier." : "Enregistrez la réunion pour pouvoir joindre des fichiers."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {attachments.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm rounded border bg-card p-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{d.filename}</span>
                      <span className="text-xs text-muted-foreground">{formatBytes(d.file_size)}</span>
                      <Button type="button" variant="ghost" size="icon" onClick={() => downloadAttachment(d)} title="Télécharger">
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => deleteAttachment(d)} title="Supprimer">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 rounded-md border p-3 bg-muted/30">
              <Button type="button" variant="outline" size="sm" onClick={sendMailToParticipants}>
                <Mail className="h-4 w-4 mr-1" /> Envoyer un mail aux participants
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={createLinkedTask}>
                <ListTodo className="h-4 w-4 mr-1" /> Créer une tâche associée
              </Button>
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
          <Button onClick={saveAndClose} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
