import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createCollabDocument } from "@/lib/collab-documents.functions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  initialTitle?: string;
  onCreated?: (documentId: string) => void;
}

export function CreateDocDialog({ open, onOpenChange, spaceId, initialTitle, onCreated }: Props) {
  const createFn = useServerFn(createCollabDocument);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [mode, setMode] = useState<"async" | "realtime">("async");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle ?? "Document sans titre");
      setMode("async");
    }
  }, [open, initialTitle]);

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast.error("Titre requis");
      return;
    }
    setSaving(true);
    try {
      const res = await createFn({ data: { spaceId, title: t, collabMode: mode } });
      toast.success("Document créé et lié à l'espace");
      onCreated?.(res.document.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau document collaboratif</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="doc-title">Titre</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="async">Asynchrone (versions)</SelectItem>
                <SelectItem value="realtime">Temps réel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Créer & lier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
