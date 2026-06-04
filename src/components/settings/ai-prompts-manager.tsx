import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Paperclip, Pencil, X, FileText, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

type Attachment = { name: string; path: string; size: number; mime: string | null };
type Prompt = {
  id: string;
  user_id: string;
  title: string;
  target: string;
  content: string;
  attachments: Attachment[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const TARGETS: { value: string; label: string }[] = [
  { value: "general", label: "Général (toutes IA)" },
  { value: "email_reply", label: "Réponses automatiques d'emails" },
  { value: "email_classify", label: "Classification d'emails" },
  { value: "task_create", label: "Création de tâches" },
  { value: "meeting", label: "Gestion des réunions" },
  { value: "meeting_slots", label: "Recherche de créneaux" },
  { value: "document", label: "Analyse de documents" },
  { value: "dashboard", label: "Dashboard / suggestions" },
];

const targetLabel = (v: string) => TARGETS.find((t) => t.value === v)?.label ?? v;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function AiPromptsManager() {
  const { user } = useAuth();
  const [items, setItems] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await db
      .from("ai_prompts")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Impossible de charger les prompts");
      return;
    }
    setItems((data ?? []) as Prompt[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const onNew = () => {
    setEditing({
      id: "",
      user_id: user?.id ?? "",
      title: "",
      target: "general",
      content: "",
      attachments: [],
      is_active: true,
      created_at: "",
      updated_at: "",
    });
    setOpen(true);
  };

  const onEdit = (p: Prompt) => {
    setEditing({ ...p, attachments: p.attachments ?? [] });
    setOpen(true);
  };

  const onDelete = async (p: Prompt) => {
    if (!confirm(`Supprimer le prompt "${p.title}" ?`)) return;
    const { error } = await db.from("ai_prompts").delete().eq("id", p.id);
    if (error) return toast.error("Échec de la suppression");
    // best-effort cleanup of attached files
    if (p.attachments?.length) {
      await supabase.storage.from("documents").remove(p.attachments.map((a) => a.path));
    }
    toast.success("Prompt supprimé");
    load();
  };

  const onToggleActive = async (p: Prompt, next: boolean) => {
    const { error } = await db.from("ai_prompts").update({ is_active: next }).eq("id", p.id);
    if (error) return toast.error("Échec de la mise à jour");
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: next } : x)));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Prompts d'amélioration</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Enrichissez l'IA avec des consignes personnalisées par cible (emails, tâches,
            réunions…). Les pièces jointes servent d'exemples ou de référence.
          </p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="h-4 w-4 mr-1" /> Nouveau prompt
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun prompt pour le moment. Cliquez sur « Nouveau prompt » pour en créer un.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className="py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{p.title}</span>
                    <Badge variant="secondary">{targetLabel(p.target)}</Badge>
                    {!p.is_active && <Badge variant="outline">désactivé</Badge>}
                    {p.attachments?.length > 0 && (
                      <Badge variant="outline" className="gap-1">
                        <Paperclip className="h-3 w-3" /> {p.attachments.length}
                      </Badge>
                    )}
                  </div>
                  {p.content && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.content}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={p.is_active}
                    onCheckedChange={(v) => onToggleActive(p, v)}
                    aria-label="Activer/désactiver"
                  />
                  <Button variant="ghost" size="icon" onClick={() => onEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(p)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <PromptDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        prompt={editing}
        onSaved={() => {
          setOpen(false);
          setEditing(null);
          load();
        }}
      />
    </Card>
  );
}

function PromptDialog({
  open,
  onOpenChange,
  prompt,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prompt: Prompt | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("general");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    setTitle(prompt.title);
    setTarget(prompt.target);
    setContent(prompt.content);
    setIsActive(prompt.is_active);
    setAttachments(prompt.attachments ?? []);
  }, [prompt]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name}: dépasse 10 Mo`);
        continue;
      }
      const path = `ai-prompts/${user.id}/${crypto.randomUUID()}-${f.name}`;
      const { error } = await supabase.storage.from("documents").upload(path, f, {
        contentType: f.type || undefined,
      });
      if (error) {
        toast.error(`Échec upload ${f.name}`);
        continue;
      }
      added.push({ name: f.name, path, size: f.size, mime: f.type || null });
    }
    setAttachments((prev) => [...prev, ...added]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = async (att: Attachment) => {
    await supabase.storage.from("documents").remove([att.path]);
    setAttachments((prev) => prev.filter((a) => a.path !== att.path));
  };

  const save = async () => {
    if (!user) return;
    if (!title.trim()) return toast.error("Titre requis");
    setSaving(true);
    const payload = {
      user_id: user.id,
      title: title.trim(),
      target,
      content,
      attachments,
      is_active: isActive,
    };
    if (prompt?.id) {
      const { error } = await db.from("ai_prompts").update(payload).eq("id", prompt.id);
      setSaving(false);
      if (error) return toast.error("Échec de l'enregistrement");
      toast.success("Prompt mis à jour");
    } else {
      const { error } = await db.from("ai_prompts").insert(payload);
      setSaving(false);
      if (error) return toast.error("Échec de la création");
      toast.success("Prompt créé");
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prompt?.id ? "Modifier le prompt" : "Nouveau prompt"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Titre</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex : Style de réponse aux mails clients"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cible</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGETS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-2 pb-1">
              <Label className="flex items-center gap-2">
                <Power className="h-4 w-4" /> Actif
              </Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Contenu du prompt</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="Décrivez les consignes, le ton, les règles ou exemples à suivre par l'IA pour cette cible…"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Pièces jointes</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Paperclip className="h-4 w-4 mr-1" />
                {uploading ? "Envoi…" : "Ajouter un fichier"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => handleUpload(e.target.files)}
              />
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun fichier joint.</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li
                    key={a.path}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1 text-sm"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{a.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(a.size / 1024).toFixed(0)} ko
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAttachment(a)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
