import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listDocumentVersions,
  getDocumentVersion,
  restoreDocumentVersion,
} from "@/lib/collab-collab.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Loader2, RotateCcw, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  onRestored?: (newVersion: number) => void;
}

interface VersionLite {
  id: string;
  version_number: number;
  title: string;
  change_summary: string | null;
  created_at: string;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  documentId,
  onRestored,
}: Props) {
  const listFn = useServerFn(listDocumentVersions);
  const getFn = useServerFn(getDocumentVersion);
  const restoreFn = useServerFn(restoreDocumentVersion);

  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const res = await listFn({ data: { documentId } });
        setVersions(res.versions as VersionLite[]);
        if (res.versions[0]) {
          setSelectedId(res.versions[0].id);
        }
      } catch (e) {
        toast.error("Chargement de l'historique échoué", {
          description: (e as Error).message,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, documentId, listFn]);

  useEffect(() => {
    if (!selectedId) {
      setPreview("");
      return;
    }
    (async () => {
      try {
        const { version } = await getFn({ data: { versionId: selectedId } });
        setPreview(jsonToPlainText(version.content));
      } catch (e) {
        setPreview("(Erreur de chargement)");
        toast.error("Aperçu indisponible", {
          description: (e as Error).message,
        });
      }
    })();
  }, [selectedId, getFn]);

  const handleRestore = async () => {
    if (!selectedId) return;
    if (
      !window.confirm(
        "Restaurer cette version ? L'état actuel sera sauvegardé comme nouvelle version avant le remplacement.",
      )
    )
      return;
    try {
      setRestoring(true);
      const res = await restoreFn({ data: { versionId: selectedId } });
      toast.success(`Version v${res.restoredFrom} restaurée (nouveau v${res.newVersion})`);
      onRestored?.(res.newVersion);
      onOpenChange(false);
    } catch (e) {
      toast.error("Restauration échouée", { description: (e as Error).message });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Historique des versions
          </DialogTitle>
          <DialogDescription>
            Sélectionne une version pour la prévisualiser, puis restaure-la si
            besoin. La restauration crée une sauvegarde de l'état actuel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 min-h-[400px]">
          <div className="border rounded-md overflow-hidden">
            <ScrollArea className="h-[420px]">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Chargement…
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8 px-3">
                  Aucune version enregistrée.
                </div>
              ) : (
                <div className="divide-y">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-accent/50 ${
                        selectedId === v.id ? "bg-accent" : ""
                      }`}
                    >
                      <div className="text-sm font-medium flex items-center gap-2">
                        v{v.version_number}
                        <span className="truncate font-normal text-muted-foreground">
                          {v.title}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(v.created_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </div>
                      {v.change_summary && (
                        <div className="text-xs text-muted-foreground italic mt-0.5 truncate">
                          {v.change_summary}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="border rounded-md p-3 bg-muted/20">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Eye className="h-3 w-3" />
              Aperçu (texte brut)
            </div>
            <ScrollArea className="h-[400px]">
              <pre className="text-sm whitespace-pre-wrap font-sans">
                {preview || "—"}
              </pre>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button
            onClick={handleRestore}
            disabled={!selectedId || restoring}
          >
            {restoring ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            Restaurer cette version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Extracts plain text from a Tiptap/ProseMirror JSON doc for preview. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonToPlainText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(jsonToPlainText).join("");
  let out = "";
  if (node.type === "text" && typeof node.text === "string") out += node.text;
  if (Array.isArray(node.content)) {
    out += node.content.map(jsonToPlainText).join("");
  }
  const blockTypes = new Set([
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "codeBlock",
    "horizontalRule",
    "tableRow",
  ]);
  if (blockTypes.has(node.type)) out += "\n";
  return out;
}
