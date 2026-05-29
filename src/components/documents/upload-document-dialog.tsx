import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { sha256, storagePath, uploadToStorage } from "@/lib/documents";
import { detectSensitive } from "@/lib/sensitive-detection";
import { useSecureVault } from "@/lib/secure-vault-context";
import { encryptAndStore } from "@/lib/secure-documents";
import { VaultPinDialog } from "@/components/security/vault-pin-dialog";
import { formatBytes } from "@/lib/file-icons";

type LinkOption = { id: string; label: string };

export function UploadDocumentDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: () => void;
}) {
  const { user } = useAuth();
  const vault = useSecureVault();
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [linkType, setLinkType] = useState<"none" | "task" | "meeting">("none");
  const [linkId, setLinkId] = useState<string>("");
  const [tasks, setTasks] = useState<LinkOption[]>([]);
  const [meetings, setMeetings] = useState<LinkOption[]>([]);
  const [maxMb, setMaxMb] = useState(25);
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingSensitive, setPendingSensitive] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFiles([]); setDescription(""); setTagsText(""); setLinkType("none"); setLinkId("");
    Promise.all([
      supabase.from("tasks").select("id,title").order("created_at", { ascending: false }).limit(100),
      supabase.from("meetings").select("id,title").order("start_at", { ascending: false }).limit(100),
      supabase.from("document_retention_settings").select("max_file_size_mb").maybeSingle(),
    ]).then(([t, m, s]) => {
      setTasks(((t.data ?? []) as { id: string; title: string }[]).map((x) => ({ id: x.id, label: x.title })));
      setMeetings(((m.data ?? []) as { id: string; title: string }[]).map((x) => ({ id: x.id, label: x.title })));
      if (s.data?.max_file_size_mb) setMaxMb(s.data.max_file_size_mb);
    });
  }, [open]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    const tooBig = arr.find((f) => f.size > maxMb * 1024 * 1024);
    if (tooBig) {
      toast.error(`${tooBig.name} dépasse la limite de ${maxMb} Mo`);
      return;
    }
    setFiles((prev) => [...prev, ...arr]);
  }, [maxMb]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }

  async function performUpload() {
    if (!user || files.length === 0) return;
    setBusy(true);
    const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
    let sensitiveDetected = false;

    try {
      for (const file of files) {
        const check = detectSensitive({ subject: file.name, body_text: description, attachment_names: [file.name] });
        const isSensitive = check.isSensitive;
        if (isSensitive) sensitiveDetected = true;

        const sourceType = linkType === "none" ? "manual" : linkType;
        const sourceId = linkType === "none" ? null : linkId || null;
        const checksum = await sha256(file);
        const docId = crypto.randomUUID();

        if (isSensitive) {
          // Stocker en local chiffré
          if (!vault.key) {
            setPendingSensitive(true);
            setPinOpen(true);
            setBusy(false);
            return;
          }
          await encryptAndStore(vault.key, docId, file);
          const { error } = await supabase.from("documents").insert({
            id: docId,
            user_id: user.id,
            filename: file.name,
            original_filename: file.name,
            file_size: file.size,
            mime_type: file.type || null,
            storage_path: null,
            source_type: sourceType,
            source_id: sourceId,
            tags,
            description: description || null,
            is_sensitive: true,
            sensitive_score: check.score,
            sensitive_reason: check.reasons.join(", "),
            local_only: true,
            checksum,
          });
          if (error) throw error;
        } else {
          const path = storagePath(user.id, sourceType, docId, file.name);
          await uploadToStorage(path, file);
          const { error } = await supabase.from("documents").insert({
            id: docId,
            user_id: user.id,
            filename: file.name,
            original_filename: file.name,
            file_size: file.size,
            mime_type: file.type || null,
            storage_path: path,
            source_type: sourceType,
            source_id: sourceId,
            tags,
            description: description || null,
            is_sensitive: false,
            local_only: false,
            checksum,
          });
          if (error) throw error;
        }
      }
      toast.success(`${files.length} document${files.length > 1 ? "s" : ""} ajouté${files.length > 1 ? "s" : ""}${sensitiveDetected ? " (sensibles → chiffrés localement)" : ""}`);
      onUploaded();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'upload");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="border-2 border-dashed rounded-md p-6 text-center text-sm text-muted-foreground hover:border-primary transition-colors"
            >
              <Upload className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p>Glissez vos fichiers ici, ou</p>
              <label className="inline-block mt-2">
                <span className="text-primary cursor-pointer underline">parcourir…</span>
                <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              <p className="text-xs mt-2">Max {maxMb} Mo par fichier</p>
            </div>

            {files.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-muted rounded px-2 py-1">
                    <span className="truncate">{f.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optionnel" />
            </div>

            <div>
              <Label>Tags (séparés par virgule)</Label>
              <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="contrat, urgent, 2025…" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Lier à</Label>
                <Select value={linkType} onValueChange={(v) => { setLinkType(v as typeof linkType); setLinkId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    <SelectItem value="task">Tâche</SelectItem>
                    <SelectItem value="meeting">Réunion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {linkType !== "none" && (
                <div>
                  <Label>&nbsp;</Label>
                  <Select value={linkId} onValueChange={setLinkId}>
                    <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                    <SelectContent>
                      {(linkType === "task" ? tasks : meetings).map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Badge variant="outline" className="gap-1 text-xs">
              <Lock className="h-3 w-3" /> Détection sensible automatique (RGPD/HDS)
            </Badge>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
            <Button onClick={performUpload} disabled={busy || files.length === 0}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VaultPinDialog
        open={pinOpen}
        onOpenChange={(v) => { setPinOpen(v); if (!v) setPendingSensitive(false); }}
        onUnlocked={() => {
          if (pendingSensitive) performUpload();
        }}
      />
    </>
  );
}
