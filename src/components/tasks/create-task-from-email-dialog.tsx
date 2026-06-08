import { useEffect, useState } from "react";
import { Paperclip, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requestAutoSync } from "@/lib/sync-queue";
import { getSignedUrl, type DocumentRow } from "@/lib/documents";
import { formatBytes } from "@/lib/file-icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export type EmailLike = {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  has_attachment: boolean;
  labels: string[] | null;
};

export function CreateTaskFromEmailDialog({
  open,
  onOpenChange,
  email,
  userId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: EmailLike;
  userId: string;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [dueDate, setDueDate] = useState("");
  const [createEvent, setCreateEvent] = useState(false);
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachmentDocs, setAttachmentDocs] = useState<DocumentRow[]>([]);
  const [fetchingAtts, setFetchingAtts] = useState(false);

  const loadAttachments = async () => {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("source_type", "email")
      .eq("source_id", email.id);
    return (data as DocumentRow[]) ?? [];
  };

  useEffect(() => {
    if (!open) return;
    setTitle(email.subject ?? "");
    const extract = (email.body_text ?? "").replace(/\s+/g, " ").slice(0, 280);
    const from = email.from_name || email.from_address || "";
    setDescription(`Depuis : ${from}\n\n${extract}${extract.length === 280 ? "…" : ""}`);
    setComments("");
    setPriority("medium");
    setDueDate("");
    setCreateEvent(false);
    setEventStart("");
    setEventEnd("");
    setEventTitle("");
    setAttachmentDocs([]);

    (async () => {
      let docs = await loadAttachments();
      // Si l'email indique des PJ mais aucune n'est en base, on les récupère à la volée
      if (docs.length === 0 && email.has_attachment) {
        setFetchingAtts(true);
        try {
          const { data: sess } = await supabase.auth.getSession();
          const token = sess?.session?.access_token;
          const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-email-attachments`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? ""}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
            },
            body: JSON.stringify({ email_id: email.id }),
          });
          const json = await res.json().catch(() => ({}));
          if (json?.ok && json?.count > 0) {
            docs = await loadAttachments();
            toast.success(`${json.count} pièce(s) jointe(s) récupérée(s)`);
          } else if (json?.error) {
            toast.error(`PJ : ${json.error}`);
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erreur récupération PJ");
        } finally {
          setFetchingAtts(false);
        }
      }
      setAttachmentDocs(docs);
    })();
  }, [open, email]);


  const runAi = async () => {
    setAnalyzing(true);
    try {
      const { analyzeEmailForTask } = await import("@/lib/api/email-analysis.functions");
      const res = await analyzeEmailForTask({
        data: {
          subject: email.subject,
          from: email.from_name || email.from_address,
          body: email.body_text ?? email.body_html ?? "",
          receivedAt: email.received_at,
        },
      });
      setTitle(res.title);
      setDescription(res.summary);
      setComments(res.comments);
      setPriority(res.priority);
      if (res.due_date) setDueDate(res.due_date.slice(0, 10));
      if (res.has_event && res.event_start) {
        setCreateEvent(true);
        setEventStart(res.event_start.slice(0, 16));
        setEventEnd((res.event_end ?? res.event_start).slice(0, 16));
        setEventTitle(res.event_title ?? res.title);
      }
      toast.success("Analyse IA terminée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur IA");
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Titre requis");
      return;
    }
    setSaving(true);
    try {
      let calendarEventId: string | null = null;
      if (createEvent && eventStart) {
        const { data: ev, error: evErr } = await supabase.from("calendar_events").insert({
          user_id: userId,
          title: eventTitle || title.trim(),
          description: `Créé depuis l'email : ${email.subject ?? ""}`,
          start_at: new Date(eventStart).toISOString(),
          end_at: new Date(eventEnd || eventStart).toISOString(),
          color: "#6366f1",
        }).select("id").single();
        if (evErr) throw evErr;
        calendarEventId = ev.id;
      }

      const dueIso = dueDate ? new Date(dueDate).toISOString() : null;
      const attachments = await Promise.all(
        attachmentDocs.map(async (d) => {
          let url: string | null = null;
          if (d.storage_path) {
            try { url = await getSignedUrl(d.storage_path); } catch { /* ignore */ }
          }
          return {
            name: d.original_filename,
            mime: d.mime_type ?? null,
            size: d.file_size ?? null,
            url,
            document_id: d.id,
            storage_path: d.storage_path ?? null,
          };
        })
      );

      const { error } = await supabase.from("tasks").insert({
        user_id: userId,
        title: title.trim(),
        description,
        comments: comments || null,
        priority,
        due_date: dueIso,
        gantt_start: dueIso,
        gantt_end: dueIso,
        source_app: "myhubpro",
        source_email_id: email.id,
        calendar_event_id: calendarEventId,
        attachments,
        tags: attachments.length > 0 ? ["attachment"] : [],
        status: "todo",
      });
      if (error) throw error;

      // Remove the "task-todo" label from the email if present
      const labels = (email.labels ?? []).filter((l) => l !== "task-todo");
      await supabase.from("emails").update({ labels }).eq("id", email.id);

      toast.success(calendarEventId ? "Tâche + événement créés" : "Tâche créée");
      requestAutoSync();
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Créer une tâche depuis ce mail</DialogTitle>
        </DialogHeader>
        <Button
          type="button"
          onClick={runAi}
          disabled={analyzing}
          className="w-full gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
        >
          <Zap className="h-4 w-4" />
          {analyzing ? "Analyse en cours…" : "✨ Pré-remplir avec l'IA"}
        </Button>
        <div className="space-y-3">
          <div>
            <Label htmlFor="t-title">Titre</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-comments">Commentaires (texte libre)</Label>
            <Textarea
              id="t-comments"
              rows={3}
              placeholder="Notes, contexte, points d'attention…"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priorité</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">🟢 Basse</SelectItem>
                  <SelectItem value="medium">🟡 Moyenne</SelectItem>
                  <SelectItem value="high">🟠 Haute</SelectItem>
                  <SelectItem value="urgent">🔴 Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-due">Échéance</Label>
              <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createEvent}
                onChange={(e) => setCreateEvent(e.target.checked)}
                className="h-4 w-4"
              />
              <span>📅 Créer aussi un événement dans l'agenda</span>
            </label>
            {createEvent && (
              <div className="mt-2 space-y-2">
                <Input
                  placeholder="Titre de l'événement"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Début</Label>
                    <Input type="datetime-local" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Fin</Label>
                    <Input type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div>🔗 Lien vers l'email source conservé (id : {email.id.slice(0, 8)}…)</div>
            {attachmentDocs.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1 font-medium text-foreground">
                  <Paperclip className="h-3 w-3" /> {attachmentDocs.length} pièce{attachmentDocs.length > 1 ? "s" : ""} jointe{attachmentDocs.length > 1 ? "s" : ""} rattachée{attachmentDocs.length > 1 ? "s" : ""} à la tâche
                </div>
                <ul className="ml-4 list-disc">
                  {attachmentDocs.map((d) => (
                    <li key={d.id}>{d.original_filename} <span className="text-[10px]">({formatBytes(d.file_size)})</span></li>
                  ))}
                </ul>
              </div>
            ) : email.has_attachment ? (
              <div className="flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> {fetchingAtts ? "Récupération des pièces jointes depuis le mail…" : "Pièces jointes détectées mais non synchronisées."}
              </div>
            ) : null}
            {dueDate && <div>📊 La tâche apparaîtra dans le rétroplanning (Gantt)</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Création…" : "Créer la tâche"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
