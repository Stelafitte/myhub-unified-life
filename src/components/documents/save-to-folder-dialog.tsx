import { useEffect, useMemo, useState } from "react";
import { Sparkles, Folder, Plus, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { DocumentRow } from "@/lib/documents";
import { suggestFolders, listFolders, type FolderSuggestion } from "@/lib/folder-suggest";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Document(s) to classify. Their tags[0] will be set to the chosen folder. */
  documents: DocumentRow[];
  /** Optional context to improve suggestions (e.g. email subject + sender). */
  context?: { fromAddress?: string | null; subject?: string | null };
  onSaved?: () => void;
};

export function SaveToFolderDialog({ open, onOpenChange, documents, context, onSaved }: Props) {
  const [allDocs, setAllDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string>("");
  const [creating, setCreating] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked("");
    setCreating("");
    setLoading(true);
    supabase.from("documents").select("*").limit(500)
      .then(({ data }) => setAllDocs((data as DocumentRow[]) ?? []))
      .finally(() => setLoading(false));
  }, [open]);

  const first = documents[0];

  const suggestions: FolderSuggestion[] = useMemo(() => {
    if (!first) return [];
    return suggestFolders(
      {
        filename: first.original_filename,
        mimeType: first.mime_type,
        fromAddress: context?.fromAddress,
        subject: context?.subject,
      },
      allDocs.filter((d) => !documents.some((x) => x.id === d.id)),
    );
  }, [first, allDocs, context, documents]);

  const folders = useMemo(() => listFolders(allDocs), [allDocs]);

  async function save() {
    const folder = (creating.trim() || picked).trim();
    if (!folder) { toast.error("Choisissez ou créez un dossier"); return; }
    setSaving(true);
    try {
      for (const d of documents) {
        const newTags = [folder, ...(d.tags ?? []).filter((t) => t !== folder)];
        const { error } = await supabase.from("documents").update({ tags: newTags }).eq("id", d.id);
        if (error) throw error;
      }
      toast.success(`Classé dans « ${folder} »`);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Classer dans Documents</DialogTitle>
          <DialogDescription>
            {documents.length === 1
              ? <>« {documents[0]?.original_filename} »</>
              : <>{documents.length} fichiers</>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Suggestions intelligentes
                </div>
                <div className="space-y-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.folder}
                      type="button"
                      onClick={() => { setPicked(s.folder); setCreating(""); }}
                      className={cn(
                        "w-full rounded-md border p-2.5 text-left text-sm transition-colors",
                        picked === s.folder && !creating
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Folder className="h-4 w-4 text-primary" />
                        <span className="font-medium">{s.folder}</span>
                        <Badge variant="secondary" className="ml-auto text-[10px]">{s.sampleCount} fichier{s.sampleCount > 1 ? "s" : ""}</Badge>
                        {picked === s.folder && !creating && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      {s.reason && <div className="mt-0.5 text-xs text-muted-foreground">{s.reason}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {folders.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Tous les dossiers</div>
                <ScrollArea className="max-h-32 rounded-md border">
                  <div className="p-1">
                    {folders.map((f) => (
                      <button
                        key={f.folder}
                        type="button"
                        onClick={() => { setPicked(f.folder); setCreating(""); }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50",
                          picked === f.folder && !creating && "bg-primary/5 text-primary",
                        )}
                      >
                        <Folder className="h-3.5 w-3.5" />
                        <span>{f.folder}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{f.count}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Ou créer un nouveau dossier</div>
              <div className="flex gap-2">
                <Plus className="mt-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={creating}
                  onChange={(e) => { setCreating(e.target.value); if (e.target.value) setPicked(""); }}
                  placeholder="Nom du dossier"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={save} disabled={saving || (!picked && !creating.trim())}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
