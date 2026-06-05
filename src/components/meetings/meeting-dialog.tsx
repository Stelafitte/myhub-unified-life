import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DebouncedInput, DebouncedTextarea } from "@/components/ui/debounced-input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactEmailAutocomplete } from "@/components/contacts/contact-email-autocomplete";
import { ContactMultiPicker } from "@/components/contacts/contact-multi-picker";
import { Users } from "lucide-react";
import { X, Download, Trash2, Sparkles, Paperclip, Mail, ListTodo, Upload, FileText, Plus, Vote, Copy, ExternalLink, CheckCircle2, HelpCircle, XCircle, Trophy, Globe, Lock, History } from "lucide-react";
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
import { AgendaSection } from "@/components/meetings/agenda-section";
import { RecurrenceSection } from "@/components/meetings/recurrence-section";
import { MeetingHistorySection } from "@/components/meetings/meeting-history-section";
import { LogisticsSection } from "@/components/meetings/logistics-section";
import { OneNoteSyncButton } from "@/components/meetings/onenote-sync-button";
import { confirmDialog } from "@/lib/confirm-dialog";
import { EmailComposer, type ComposerInitial, type ComposerAccount, type ComposerAttachment } from "@/components/inbox/email-composer";
import { useTaskPanel } from "@/lib/task-panel-context";

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
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  session_number: number | null;
  room: string;
  quorum_minimum: number | null;
  equipment: string[];
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
  recurrence_rule: null,
  recurrence_parent_id: null,
  session_number: null,
  room: "",
  quorum_minimum: null,
  equipment: [],
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
  onOpenMeeting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meetingId?: string | null;
  initial?: Partial<MeetingFormValue>;
  onSaved?: () => void;
  onOpenMeeting?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<MeetingFormValue>(empty);
  const [oneNoteUrl, setOneNoteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPart, setNewPart] = useState({ email: "", name: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<DocumentRow[]>([]);
  const [sharedMap, setSharedMap] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [autoAttachToMail, setAutoAttachToMail] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taskPanel = useTaskPanel();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<ComposerInitial>({ mode: "new" });
  const [composerAccounts, setComposerAccounts] = useState<ComposerAccount[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [notesSavedAt, setNotesSavedAt] = useState<Date | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotesRef = useRef<string>("");
  const [notesHistory, setNotesHistory] = useState<{ id: string; created_at: string; content: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [acceptedCount, setAcceptedCount] = useState(0);

  // --- Poll mode state ---
  const [pollMode, setPollMode] = useState(false);
  const [pollSlots, setPollSlots] = useState<{ id?: string; startAt: string; endAt: string }[]>([]);
  const [pollDeadline, setPollDeadline] = useState<string>("");
  const [existingPoll, setExistingPoll] = useState<{ id: string; public_token: string; status?: string } | null>(null);
  const [pollVotes, setPollVotes] = useState<{ slot_id: string; vote: string; voter_email: string }[]>([]);
  const [confirmedSlotId, setConfirmedSlotId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Sélection multiple des créneaux disponibles (alimente start/end ou le sondage)
  const [selectedAvailable, setSelectedAvailable] = useState<{ startAt: string; endAt: string }[]>([]);
  // Mode manuel : si l'utilisateur saisit lui-même Début/Fin, on grise les créneaux disponibles
  const [manualMode, setManualMode] = useState(false);
  const selectedAvailableKeys = new Set(selectedAvailable.map((s) => s.startAt));

  // --- Prep: duration + search horizon (asked early, drives slot search) ---
  const [prepDuration, setPrepDuration] = useState<number>(60);
  const [prepDays, setPrepDays] = useState<number>(30);
  const toLocalDateInput = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const [searchFrom, setSearchFrom] = useState<string>(() => toLocalDateInput(new Date()));
  const [searchTo, setSearchTo] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toLocalDateInput(d);
  });

  async function loadAttachments(id: string) {
    const [{ data }, { data: shared }] = await Promise.all([
      supabase
        .from("documents")
        .select("*")
        .eq("source_type", "meeting")
        .eq("source_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("meeting_shared_files")
        .select("document_id, share_with_externals")
        .eq("meeting_id", id),
    ]);
    setAttachments((data ?? []) as DocumentRow[]);
    const map: Record<string, boolean> = {};
    ((shared ?? []) as { document_id: string; share_with_externals: boolean }[]).forEach((r) => {
      map[r.document_id] = r.share_with_externals;
    });
    setSharedMap(map);
  }

  async function loadNotesHistory(id: string) {
    const { data } = await supabase
      .from("meeting_notes_history")
      .select("id, created_at, content")
      .eq("meeting_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotesHistory((data ?? []) as { id: string; created_at: string; content: string }[]);
  }

  useEffect(() => {
    if (!open) return;
    setAttachments([]);
    setSharedMap({});
    setNotesSavedAt(null);
    setNotesHistory([]);
    setShowHistory(false);
    setPollSlots([]);
    setPollDeadline("");
    setPollMode(false);
    setExistingPoll(null);
    setPollVotes([]);
    setConfirmedSlotId(null);
    setAcceptedCount(0);
    setOneNoteUrl(null);
    setPrepDuration(60);
    setPrepDays(30);
    setSelectedAvailable([]);
    setManualMode(false);
    if (meetingId) {
      setLoading(true);
      (async () => {
        const [{ data: m }, { data: ps }, { data: polls }] = await Promise.all([
          supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle(),
          supabase.from("meeting_participants").select("*").eq("meeting_id", meetingId),
          supabase.from("meeting_polls").select("id, public_token, deadline, status").eq("meeting_id", meetingId).order("created_at", { ascending: false }).limit(1),
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
            recurrence_rule: (m as { recurrence_rule?: string | null }).recurrence_rule ?? null,
            recurrence_parent_id: (m as { recurrence_parent_id?: string | null }).recurrence_parent_id ?? null,
            session_number: (m as { session_number?: number | null }).session_number ?? null,
            room: (m as { room?: string | null }).room ?? "",
            quorum_minimum: (m as { quorum_minimum?: number | null }).quorum_minimum ?? null,
            equipment: ((m as { equipment?: string[] | null }).equipment ?? []) as string[],
          });
          if (m.start_at && m.end_at) {
            const mins = Math.round((new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000);
            if (mins > 0) setPrepDuration(mins);
          }
          setOneNoteUrl((m as { onenote_page_url?: string | null }).onenote_page_url ?? null);
          setAcceptedCount(((ps ?? []) as { rsvp_status: string | null }[]).filter((p) => p.rsvp_status === "accepted").length);
          setConfirmedSlotId((m as { confirmed_slot_id?: string | null }).confirmed_slot_id ?? null);
          lastSavedNotesRef.current = m.notes ?? "";
          setNotesSavedAt((m as { notes_updated_at?: string | null }).notes_updated_at ? new Date((m as { notes_updated_at: string }).notes_updated_at) : null);
          loadAttachments(meetingId);
          loadNotesHistory(meetingId);
          const poll = polls?.[0];
          if (poll) {
            setExistingPoll({ id: poll.id, public_token: poll.public_token, status: poll.status });
            // Only auto-enable poll edit mode if poll is still open
            setPollMode(poll.status !== "closed");
            if (poll.deadline) setPollDeadline(toLocalInput(poll.deadline));
            const [{ data: slots }, { data: votes }] = await Promise.all([
              supabase.from("meeting_poll_slots").select("id, start_at, end_at").eq("poll_id", poll.id).order("position", { ascending: true }),
              supabase.from("meeting_poll_votes").select("slot_id, vote, voter_email").eq("poll_id", poll.id),
            ]);
            setPollSlots((slots ?? []).map((s) => ({ id: s.id, startAt: s.start_at, endAt: s.end_at })));
            setPollVotes((votes ?? []) as { slot_id: string; vote: string; voter_email: string }[]);
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

  function addPart(emailOverride?: string, nameOverride?: string) {
    const email = (emailOverride ?? newPart.email).trim();
    const name = (nameOverride ?? newPart.name).trim();
    if (!email) return;
    if (form.participants.some((p) => p.email.toLowerCase() === email.toLowerCase())) {
      toast.error("Participant déjà ajouté");
      return;
    }
    setForm((f) => ({ ...f, participants: [...f.participants, { email, name, role: "required" }] }));
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
        room: form.room.trim() || null,
        quorum_minimum: form.quorum_minimum,
        equipment: form.equipment,
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
          setExistingPoll({ id: data.id, public_token: data.public_token, status: "open" });
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
      // Flush any files added before the meeting existed.
      if (pendingFiles.length > 0) {
        try {
          await uploadFilesForMeeting(id!, pendingFiles);
          setPendingFiles([]);
          await loadAttachments(id!);
        } catch (e) {
          toast.error(e instanceof Error ? `PJ: ${e.message}` : "Erreur upload PJ");
        }
      }
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

  // --- Confirm winning slot ---
  async function confirmSlot(slot: { id?: string; startAt: string; endAt: string }) {
    if (!form.id || !existingPoll || !slot.id) {
      toast.error("Enregistrez le sondage avant de confirmer un créneau.");
      return;
    }
    if (!await confirmDialog("Confirmer ce créneau comme date définitive de la réunion ? Le sondage sera clôturé.")) return;
    setConfirming(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: mErr } = await supabase
        .from("meetings")
        .update({
          start_at: slot.startAt,
          end_at: slot.endAt,
          confirmed_slot_id: slot.id,
          confirmed_at: nowIso,
          status: "scheduled",
        })
        .eq("id", form.id);
      if (mErr) throw mErr;
      const { error: pErr } = await supabase
        .from("meeting_polls")
        .update({ status: "closed" })
        .eq("id", existingPoll.id);
      if (pErr) throw pErr;
      setConfirmedSlotId(slot.id);
      setExistingPoll((p) => (p ? { ...p, status: "closed" } : p));
      setPollMode(false);
      setForm((f) => ({
        ...f,
        start_at: toLocalInput(slot.startAt),
        end_at: toLocalInput(slot.endAt),
      }));
      toast.success("Créneau confirmé, sondage clôturé.");
      onSaved?.();
      requestAutoSync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setConfirming(false);
    }
  }

  // --- Notes autosave (debounced 30s) ---
  async function flushNotesNow() {
    if (!user || !form.id) return;
    const content = form.notes ?? "";
    if (content === lastSavedNotesRef.current) return;
    setNotesSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("meetings")
        .update({ notes: content || null, notes_updated_at: nowIso })
        .eq("id", form.id);
      if (error) throw error;
      if (content.trim()) {
        await supabase.from("meeting_notes_history").insert({
          meeting_id: form.id,
          user_id: user.id,
          content,
        });
      }
      lastSavedNotesRef.current = content;
      setNotesSavedAt(new Date(nowIso));
      loadNotesHistory(form.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur autosave notes");
    } finally {
      setNotesSaving(false);
    }
  }

  useEffect(() => {
    if (!form.id) return;
    if ((form.notes ?? "") === lastSavedNotesRef.current) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      flushNotesNow();
    }, 30000);
    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.notes, form.id]);

  async function restoreNoteVersion(version: { content: string }) {
    if (!await confirmDialog("Remplacer les notes actuelles par cette version ?")) return;
    setForm((f) => ({ ...f, notes: version.content }));
    // Trigger immediate save
    setTimeout(() => flushNotesNow(), 100);
  }

  // --- Share toggle on attachments ---
  async function toggleShareWithExternals(doc: DocumentRow, share: boolean) {
    if (!user || !form.id) return;
    if (share && doc.is_sensitive) {
      toast.error("Document marqué sensible : partage bloqué.");
      return;
    }
    try {
      if (share) {
        const { error } = await supabase
          .from("meeting_shared_files")
          .upsert(
            {
              meeting_id: form.id,
              document_id: doc.id,
              user_id: user.id,
              share_with_externals: true,
            },
            { onConflict: "meeting_id,document_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("meeting_shared_files")
          .delete()
          .eq("meeting_id", form.id)
          .eq("document_id", doc.id);
        if (error) throw error;
      }
      setSharedMap((m) => ({ ...m, [doc.id]: share }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur partage");
    }
  }


  async function uploadFilesForMeeting(meetingId: string, files: File[]) {
    if (!user || files.length === 0) return;
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
        source_id: meetingId,
        tags: [],
        checksum,
      });
      if (error) throw error;
    }
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (!user) {
      toast.error("Session non chargée — réessayez dans un instant");
      return;
    }
    // If meeting not saved yet, buffer files locally — they'll upload on save.
    if (!form.id) {
      setPendingFiles((p) => [...p, ...files]);
      toast.success(`${files.length} fichier(s) en attente — seront ajoutés à l'enregistrement`);
      return;
    }
    setUploading(true);
    try {
      await uploadFilesForMeeting(form.id, files);
      await loadAttachments(form.id);
      toast.success("Fichier(s) ajouté(s)");
    } catch (err) {
      console.error("[meeting] upload error", err);
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
    if (!await confirmDialog(`Supprimer "${doc.filename}" ?`)) return;
    try {
      if (doc.storage_path) await removeFromStorage(doc.storage_path);
      if (form.id) await supabase.from("meeting_shared_files").delete().eq("meeting_id", form.id).eq("document_id", doc.id);
      await supabase.from("documents").delete().eq("id", doc.id);
      setAttachments((a) => a.filter((d) => d.id !== doc.id));
      setSharedMap((m) => { const { [doc.id]: _omit, ...rest } = m; return rest; });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur suppression");
    }
  }

  // --- Quick actions ---
  async function fileToBase64(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error ?? new Error("read error"));
      fr.onload = () => {
        const res = fr.result as string;
        const idx = res.indexOf(",");
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      fr.readAsDataURL(file);
    });
  }

  async function buildAttachmentsForMail(): Promise<ComposerAttachment[]> {
    const out: ComposerAttachment[] = [];
    for (const d of attachments) {
      if (!d.storage_path) continue;
      try {
        const url = await getSignedUrl(d.storage_path, 120);
        const res = await fetch(url);
        const blob = await res.blob();
        const b64 = await fileToBase64(blob);
        out.push({
          name: d.filename,
          type: d.mime_type || blob.type || "application/octet-stream",
          size: d.file_size || blob.size,
          contentBase64: b64,
        });
      } catch (e) {
        console.warn("Skipping attachment", d.filename, e);
      }
    }
    for (const f of pendingFiles) {
      try {
        const b64 = await fileToBase64(f);
        out.push({ name: f.name, type: f.type || "application/octet-stream", size: f.size, contentBase64: b64 });
      } catch (e) {
        console.warn("Skipping pending file", f.name, e);
      }
    }
    return out;
  }

  async function sendMailToParticipants() {
    if (!user) return;
    const recipients = form.participants.map((p) => p.email).filter(Boolean);
    if (recipients.length === 0) {
      toast.error("Aucun participant");
      return;
    }
    const dateStr = form.start_at ? new Date(fromLocalInput(form.start_at)).toLocaleString("fr-FR") : "";
    const bodyLines = [
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

    // Load sendable accounts
    const { data: accs } = await supabase
      .from("accounts")
      .select("id, name, type, color, icon, credentials")
      .eq("user_id", user.id)
      .eq("is_active", true);
    const accounts = (accs ?? []) as ComposerAccount[];
    if (accounts.filter((a) => ["gmail", "outlook", "imap"].includes(a.type)).length === 0) {
      toast.error("Aucun compte mail configuré");
      return;
    }

    // Optional: attach meeting PJ (controlled by the "Joindre au mail" switch)
    let attachs: ComposerAttachment[] = [];
    const hasAny = attachments.length > 0 || pendingFiles.length > 0;
    if (hasAny && autoAttachToMail) {
      const totalCount = attachments.length + pendingFiles.length;
      const toastId = toast.loading(`Préparation de ${totalCount} pièce(s) jointe(s)…`);
      try {
        attachs = await buildAttachmentsForMail();
        toast.success(`${attachs.length} PJ prête(s)`, { id: toastId });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur PJ", { id: toastId });
      }
    }

    setComposerAccounts(accounts);
    setComposerAttachments(attachs);
    setComposerInitial({
      mode: "new",
      to: recipients.join(", "),
      subject: `Invitation : ${form.title}`,
      body: bodyLines,
    });
    setComposerOpen(true);
  }

  function createLinkedTask() {
    const dateStr = form.start_at
      ? new Date(fromLocalInput(form.start_at)).toLocaleString("fr-FR")
      : "";
    const contextLines = [
      `Réunion : ${form.title}`,
      dateStr ? `Date : ${dateStr}` : "",
      form.location ? `Lieu : ${form.location}` : "",
      form.is_online && form.online_link ? `Visio : ${form.online_link}` : "",
      form.organizer_name ? `Organisateur : ${form.organizer_name}` : "",
      form.participants.length > 0
        ? `Participants : ${form.participants.map((p) => p.name || p.email).join(", ")}`
        : "",
      form.description ? `\n${form.description}` : "",
      form.notes ? `\nNotes :\n${form.notes}` : "",
    ].filter(Boolean).join("\n");
    taskPanel.openCreate({
      title: `Préparer : ${form.title}`,
      description: contextLines,
      due: form.start_at || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {form.id ? "Modifier la réunion" : "Nouvelle réunion"}
            <Badge className={cn("ml-2 text-xs", IMPORTANCE_META[form.importance].cls)}>
              {IMPORTANCE_META[form.importance].label}
            </Badge>
            {form.id && (
              <div className="ml-auto">
                <OneNoteSyncButton
                  meetingId={form.id}
                  pageUrl={oneNoteUrl}
                  onSynced={(url) => setOneNoteUrl(url)}
                />
              </div>
            )}
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
                <DebouncedInput id="m-title" withMic value={form.title} onValueChange={(v) => setForm((f) => ({ ...f, title: v }))} />
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

            {/* Préparation : durée + période de recherche (demandé tôt, pilote la recherche de créneaux) */}
            <div className="rounded-md border p-3 bg-muted/10 space-y-3">
              <div className="text-sm font-medium">Préparation du créneau</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m-prep-duration">Durée de la réunion</Label>
                  <Select
                    value={String(prepDuration)}
                    onValueChange={(v) => {
                      const mins = Number(v);
                      setPrepDuration(mins);
                      // Si un début est déjà défini, on aligne la fin sur la nouvelle durée
                      if (form.start_at) {
                        const startMs = new Date(fromLocalInput(form.start_at)).getTime();
                        const endIso = new Date(startMs + mins * 60000).toISOString();
                        setForm((f) => ({ ...f, end_at: toLocalInput(endIso) }));
                      }
                    }}
                  >
                    <SelectTrigger id="m-prep-duration"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                      <SelectItem value="60">1 h</SelectItem>
                      <SelectItem value="90">1 h 30</SelectItem>
                      <SelectItem value="120">2 h</SelectItem>
                      <SelectItem value="180">3 h</SelectItem>
                      <SelectItem value="240">4 h</SelectItem>
                      <SelectItem value="480">Journée (8 h)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="m-prep-days">Période de recherche</Label>
                  <Select
                    value={String(prepDays)}
                    onValueChange={(v) => {
                      const days = Number(v);
                      setPrepDays(days);
                      // Aligner les bornes sur la nouvelle période (début = aujourd'hui, fin = +N jours)
                      const start = new Date();
                      start.setHours(0, 0, 0, 0);
                      const end = new Date(start.getTime() + days * 86400_000);
                      setSearchFrom(toLocalDateInput(start));
                      setSearchTo(toLocalDateInput(end));
                    }}
                  >
                    <SelectTrigger id="m-prep-days"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 prochains jours</SelectItem>
                      <SelectItem value="14">14 prochains jours</SelectItem>
                      <SelectItem value="30">30 prochains jours</SelectItem>
                      <SelectItem value="60">60 prochains jours</SelectItem>
                      <SelectItem value="90">90 prochains jours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m-search-from">Date de début de recherche</Label>
                  <Input
                    id="m-search-from"
                    type="date"
                    value={searchFrom}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSearchFrom(v);
                      if (v && searchTo) {
                        const diff = Math.max(1, Math.round((new Date(searchTo).getTime() - new Date(v).getTime()) / 86400_000));
                        setPrepDays(Math.min(90, diff));
                      }
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="m-search-to">Date de fin de recherche</Label>
                  <Input
                    id="m-search-to"
                    type="date"
                    value={searchTo}
                    min={searchFrom || undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSearchTo(v);
                      if (v && searchFrom) {
                        const diff = Math.max(1, Math.round((new Date(v).getTime() - new Date(searchFrom).getTime()) / 86400_000));
                        setPrepDays(Math.min(90, diff));
                      }
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                La recherche de créneaux (manuelle ou IA) utilise vos agendas Google connectés (perso + pro) et vos réunions internes sur cette période.
              </p>
            </div>

            <SlotFinder
              durationMinutes={prepDuration}
              daysAhead={prepDays}
              disabled={manualMode}
              selectedKeys={selectedAvailableKeys}
              onToggleSelect={(s) => {
                setSelectedAvailable((arr) => {
                  const exists = arr.some((x) => x.startAt === s.startAt);
                  const next = exists
                    ? arr.filter((x) => x.startAt !== s.startAt)
                    : [...arr, { startAt: s.startAt, endAt: s.endAt }];
                  // En mode sondage : on synchronise pollSlots avec la sélection
                  if (pollMode) {
                    setPollSlots((ps) => {
                      if (exists) return ps.filter((x) => x.startAt !== s.startAt);
                      if (ps.some((x) => x.startAt === s.startAt)) return ps;
                      return [...ps, { startAt: s.startAt, endAt: s.endAt }].sort(
                        (a, b) => a.startAt.localeCompare(b.startAt),
                      );
                    });
                  } else if (next.length === 1) {
                    // Hors sondage : 1 créneau coché → alimente start/end de la réunion
                    setForm((f) => ({
                      ...f,
                      start_at: toLocalInput(next[0].startAt),
                      end_at: toLocalInput(next[0].endAt),
                    }));
                  }
                  return next;
                });
              }}
              onPick={() => {}}
            />

            {/* Poll mode toggle */}
            <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
              <div>
                <Label htmlFor="m-poll" className="cursor-pointer flex items-center gap-1.5">
                  <Vote className="h-4 w-4" /> Mode sondage de dates
                </Label>
                <p className="text-xs text-muted-foreground">
                  Utilise les créneaux disponibles sélectionnés ci-dessus pour lancer un vote.
                </p>
              </div>
              <Switch
                id="m-poll"
                checked={pollMode}
                onCheckedChange={(v) => {
                  setPollMode(v);
                  if (v && selectedAvailable.length > 0) {
                    setPollSlots((ps) => {
                      const merged = [...ps];
                      for (const s of selectedAvailable) {
                        if (!merged.some((x) => x.startAt === s.startAt)) {
                          merged.push({ startAt: s.startAt, endAt: s.endAt });
                        }
                      }
                      return merged.sort((a, b) => a.startAt.localeCompare(b.startAt));
                    });
                  }
                }}
              />
            </div>

            {!pollMode && (
              <div className={cn("space-y-2", selectedAvailable.length > 1 && "opacity-60")}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  ou créneau manuel
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="m-start">Début</Label>
                    <Input
                      id="m-start"
                      type="datetime-local"
                      value={form.start_at}
                      onChange={(e) => {
                        const v = e.target.value;
                        setManualMode(true);
                        setSelectedAvailable([]);
                        let endVal = form.end_at;
                        if (v) {
                          const startMs = new Date(fromLocalInput(v)).getTime();
                          const mins = prepDuration || 60;
                          endVal = toLocalInput(new Date(startMs + mins * 60000).toISOString());
                        }
                        setForm({ ...form, start_at: v, end_at: endVal });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="m-end">Fin</Label>
                    <Input
                      id="m-end"
                      type="datetime-local"
                      value={form.end_at}
                      onChange={(e) => {
                        setManualMode(true);
                        setSelectedAvailable([]);
                        setForm({ ...form, end_at: e.target.value });
                      }}
                    />
                  </div>
                </div>
                {manualMode && (
                  <button
                    type="button"
                    onClick={() => setManualMode(false)}
                    className="text-xs text-primary hover:underline"
                  >
                    Réactiver la sélection dans « Créneaux disponibles »
                  </button>
                )}
              </div>
            )}

            {pollMode && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label>Créneaux proposés ({pollSlots.length})</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addManualPollSlot}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter
                  </Button>
                </div>
                {pollSlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aucun créneau. Sélectionnez-en dans « Créneaux disponibles » ci-dessus, ou ajoutez-en manuellement.
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

                {existingPoll && pollSlots.length > 0 && (() => {
                  const counts = pollSlots.map((s) => {
                    const vs = pollVotes.filter((v) => v.slot_id === s.id);
                    return {
                      slot: s,
                      yes: vs.filter((v) => v.vote === "yes").length,
                      maybe: vs.filter((v) => v.vote === "maybe").length,
                      no: vs.filter((v) => v.vote === "no").length,
                      score: vs.filter((v) => v.vote === "yes").length * 2 + vs.filter((v) => v.vote === "maybe").length,
                    };
                  });
                  const totalVoters = new Set(pollVotes.map((v) => v.voter_email.toLowerCase())).size;
                  const maxScore = Math.max(...counts.map((c) => c.score), 0);
                  return (
                    <div className="rounded-md border bg-background p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium flex items-center gap-1">
                          <Trophy className="h-3.5 w-3.5" /> Résultats du sondage
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {totalVoters} votant{totalVoters > 1 ? "s" : ""}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {counts.map((c) => {
                          const isWinner = maxScore > 0 && c.score === maxScore;
                          const isConfirmed = confirmedSlotId === c.slot.id;
                          return (
                            <li
                              key={c.slot.id ?? c.slot.startAt}
                              className={cn(
                                "flex items-center gap-2 rounded border p-2 text-sm",
                                isConfirmed
                                  ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                                  : isWinner
                                    ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
                                    : "bg-card",
                              )}
                            >
                              <span className="flex-1 min-w-0">
                                {new Date(c.slot.startAt).toLocaleDateString("fr-FR", {
                                  weekday: "short", day: "2-digit", month: "short",
                                })}
                                {" · "}
                                {new Date(c.slot.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                                {" → "}
                                {new Date(c.slot.endAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                                {isWinner && !isConfirmed && (
                                  <Badge variant="outline" className="ml-2 text-[10px] border-amber-500 text-amber-700 dark:text-amber-300">
                                    Préféré
                                  </Badge>
                                )}
                                {isConfirmed && (
                                  <Badge className="ml-2 text-[10px] bg-green-600 hover:bg-green-600">
                                    Confirmé
                                  </Badge>
                                )}
                              </span>
                              <span className="flex items-center gap-2 text-xs shrink-0">
                                <span className="flex items-center gap-0.5 text-green-600" title="Oui">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> {c.yes}
                                </span>
                                <span className="flex items-center gap-0.5 text-amber-600" title="Peut-être">
                                  <HelpCircle className="h-3.5 w-3.5" /> {c.maybe}
                                </span>
                                <span className="flex items-center gap-0.5 text-red-600" title="Non">
                                  <XCircle className="h-3.5 w-3.5" /> {c.no}
                                </span>
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant={isConfirmed ? "secondary" : isWinner ? "default" : "outline"}
                                disabled={confirming || isConfirmed || !form.id}
                                onClick={() => confirmSlot(c.slot)}
                              >
                                {isConfirmed ? "✓" : "Confirmer"}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-[11px] text-muted-foreground">
                        Confirmer un créneau met à jour la date de la réunion et clôture le sondage.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            {existingPoll && existingPoll.status === "closed" && !pollMode && (
              <div className="rounded-md border border-green-500/40 bg-green-50 dark:bg-green-950/30 p-3 text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-green-600" />
                <span className="text-green-800 dark:text-green-200">
                  Sondage clôturé — créneau confirmé.
                </span>
              </div>
            )}
            <div>
              <Label htmlFor="m-loc">Lieu</Label>
              <DebouncedInput id="m-loc" placeholder="Salle, adresse…" value={form.location} onValueChange={(v) => setForm((f) => ({ ...f, location: v }))} />
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
                    <DebouncedInput
                      id="m-link"
                      placeholder="https://…"
                      value={form.online_link}
                      onValueChange={(v) => setForm((f) => ({ ...f, online_link: v }))}
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
                    <DebouncedInput id="m-zpwd" value={form.zoom_password} onValueChange={(v) => setForm((f) => ({ ...f, zoom_password: v }))} />
                  </div>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="m-desc">Description / Ordre du jour</Label>
              <DebouncedTextarea id="m-desc" rows={3} value={form.description} onValueChange={(v) => setForm((f) => ({ ...f, description: v }))} />
            </div>

            {user && (
              <LogisticsSection
                userId={user.id}
                room={form.room}
                quorumMinimum={form.quorum_minimum}
                equipment={form.equipment}
                acceptedCount={acceptedCount}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              />
            )}

            {form.id && user && form.start_at && form.end_at && (
              <AgendaSection
                meetingId={form.id}
                meetingTitle={form.title}
                meetingStartAt={form.start_at}
                meetingEndAt={form.end_at}
                participants={form.participants.map((p) => ({ email: p.email, name: p.name }))}
                userId={user.id}
              />
            )}

            {form.id && user && !pollMode && form.start_at && form.end_at && (
              <RecurrenceSection
                meetingId={form.id}
                userId={user.id}
                startAt={fromLocalInput(form.start_at)}
                endAt={fromLocalInput(form.end_at)}
                parentId={form.recurrence_parent_id}
                currentRule={form.recurrence_rule}
                sessionNumber={form.session_number}
                onGenerated={() => {
                  onSaved?.();
                  toast.success("Série créée — vous pouvez ouvrir chaque session depuis l'historique.");
                  setForm((f) => ({ ...f, recurrence_rule: f.recurrence_rule ?? "weekly", session_number: 1 }));
                }}
              />
            )}

            {form.id && (form.recurrence_rule || form.recurrence_parent_id) && (
              <MeetingHistorySection
                meetingId={form.id}
                parentId={form.recurrence_parent_id}
                onOpen={(id) => {
                  if (onOpenMeeting) {
                    onOpenChange(false);
                    setTimeout(() => onOpenMeeting(id), 100);
                  }
                }}
              />
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="m-notes">Notes de préparation</Label>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {notesSaving ? (
                    <span>Enregistrement…</span>
                  ) : notesSavedAt ? (
                    <span>Sauvegardé à {notesSavedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  ) : form.id ? (
                    <span className="opacity-60">Autosave 30s</span>
                  ) : null}
                  {form.id && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={flushNotesNow} disabled={notesSaving}>
                      Enregistrer
                    </Button>
                  )}
                  {form.id && notesHistory.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => setShowHistory((s) => !s)}>
                      <History className="h-3.5 w-3.5 mr-1" /> {notesHistory.length}
                    </Button>
                  )}
                </div>
              </div>
              <DebouncedTextarea
                id="m-notes"
                rows={4}
                placeholder="Points à aborder, questions, éléments à vérifier…"
                value={form.notes}
                onValueChange={(v) => setForm((f) => ({ ...f, notes: v }))}
                onBlur={() => form.id && flushNotesNow()}
              />
              {showHistory && notesHistory.length > 0 && (
                <div className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-[11px] text-muted-foreground mb-1">Historique des versions (max 50)</p>
                  {notesHistory.map((v) => (
                    <div key={v.id} className="flex items-start gap-2 text-xs rounded border bg-card p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-muted-foreground mb-0.5">
                          {new Date(v.created_at).toLocaleString("fr-FR")}
                        </div>
                        <div className="line-clamp-2 whitespace-pre-wrap">{v.content || <em>(vide)</em>}</div>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => restoreNoteVersion(v)}>
                        Restaurer
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Participants</Label>
                <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setPickerOpen(true)}>
                  <Users className="h-3.5 w-3.5 mr-1" /> Depuis contacts
                </Button>
              </div>
              <div className="flex gap-2">
                <ContactEmailAutocomplete
                  value={newPart.email}
                  onChange={(v) => setNewPart({ ...newPart, email: v })}
                  onSelect={(email) => addPart(email)}
                  onEnter={() => addPart()}
                  placeholder="email@exemple.com"
                />
                <Input
                  placeholder="Nom (optionnel)"
                  value={newPart.name}
                  onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPart())}
                />
                <Button type="button" variant="outline" onClick={() => addPart()}>Ajouter</Button>
              </div>
              <ContactMultiPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                excludeEmails={form.participants.map((p) => p.email)}
                onConfirm={(items) => {
                  setForm((f) => {
                    const existing = new Set(f.participants.map((p) => p.email.toLowerCase()));
                    const toAdd = items
                      .filter((it) => !existing.has(it.email.toLowerCase()))
                      .map((it) => ({ email: it.email, name: it.name, role: "required" as const }));
                    if (toAdd.length === 0) return f;
                    toast.success(`${toAdd.length} participant(s) ajouté(s)`);
                    return { ...f, participants: [...f.participants, ...toAdd] };
                  });
                }}
              />

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
              {attachments.length === 0 && pendingFiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun fichier.</p>
              ) : (
                <ul className="space-y-1">
                  {attachments.map((d) => {
                    const shared = !!sharedMap[d.id];
                    return (
                      <li key={d.id} className="flex items-center gap-2 text-sm rounded border bg-card p-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">
                          {d.filename}
                          {d.is_sensitive && (
                            <Badge variant="outline" className="ml-1.5 text-[10px] border-red-300 text-red-700 dark:text-red-300 gap-0.5">
                              <Lock className="h-2.5 w-2.5" /> Sensible
                            </Badge>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatBytes(d.file_size)}</span>
                        <div className="flex items-center gap-1.5 pr-1" title={d.is_sensitive ? "Partage bloqué : document sensible" : "Partager avec les invités externes (page publique du sondage)"}>
                          <Globe className={cn("h-3.5 w-3.5", shared ? "text-primary" : "text-muted-foreground")} />
                          <Switch
                            checked={shared}
                            disabled={d.is_sensitive}
                            onCheckedChange={(v) => toggleShareWithExternals(d, v)}
                          />
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => downloadAttachment(d)} title="Télécharger">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => deleteAttachment(d)} title="Supprimer">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </li>
                    );
                  })}
                  {pendingFiles.map((f, i) => (
                    <li key={`pending-${i}`} className="flex items-center gap-2 text-sm rounded border border-dashed bg-muted/30 p-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">
                        {f.name}
                        <Badge variant="outline" className="ml-1.5 text-[10px]">En attente</Badge>
                      </span>
                      <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} title="Retirer">
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
                if (!await confirmDialog("Supprimer cette réunion ?")) return;
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
      <EmailComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        accounts={composerAccounts}
        initial={composerInitial}
        initialAttachments={composerAttachments}
      />
    </Dialog>
  );
}
