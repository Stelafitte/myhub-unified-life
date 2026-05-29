import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Lock, Loader2, ExternalLink } from "lucide-react";
import { type DocumentRow, getSignedUrl, downloadAsBlob } from "@/lib/documents";
import { decryptBlob } from "@/lib/secure-documents";
import { useSecureVault } from "@/lib/secure-vault-context";
import { categorize, iconFor, colorFor, formatBytes, sourceLabel } from "@/lib/file-icons";
import { VaultPinDialog } from "@/components/security/vault-pin-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export function DocumentPreviewSheet({
  doc,
  onOpenChange,
}: {
  doc: DocumentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const vault = useSecureVault();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    if (!doc) return;

    let blobUrl: string | null = null;
    (async () => {
      setLoading(true);
      try {
        if (doc.local_only) {
          if (!vault.key) { setPinOpen(true); return; }
          const blob = await decryptBlob(vault.key, doc.id);
          if (!blob) throw new Error("Fichier introuvable dans le coffre local");
          blobUrl = URL.createObjectURL(blob);
          setUrl(blobUrl);
        } else if (doc.storage_path) {
          const signed = await getSignedUrl(doc.storage_path);
          setUrl(signed);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Aperçu indisponible");
      } finally {
        setLoading(false);
      }
    })();

    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, vault.key]);

  async function downloadFile() {
    if (!doc) return;
    try {
      let blob: Blob;
      if (doc.local_only) {
        if (!vault.key) { setPinOpen(true); return; }
        const b = await decryptBlob(vault.key, doc.id);
        if (!b) throw new Error("Fichier introuvable");
        blob = b;
      } else if (doc.storage_path) {
        blob = await downloadAsBlob(doc.storage_path);
      } else return;
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = doc.original_filename; a.click();
      URL.revokeObjectURL(u);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Téléchargement échoué");
    }
  }

  if (!doc) return null;

  const cat = categorize(doc.mime_type, doc.filename);
  const Icon = iconFor(cat);
  const src = sourceLabel(doc.source_type);

  return (
    <>
      <Sheet open={!!doc} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 pr-6">
              <Icon className={`h-5 w-5 ${colorFor(cat)} shrink-0`} />
              <span className="truncate">{doc.filename}</span>
              {doc.is_sensitive && <Badge variant="destructive" className="gap-1"><Lock className="h-3 w-3" />Sensible</Badge>}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`px-2 py-0.5 rounded-full ${src.cls}`}>{src.label}</span>
              <span>{formatBytes(doc.file_size)}</span>
              <span>·</span>
              <span>{format(new Date(doc.created_at), "d MMM yyyy HH:mm", { locale: fr })}</span>
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {loading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
              </div>
            )}

            {!loading && url && cat === "pdf" && (
              <iframe src={url} className="w-full h-[70vh] border rounded" title={doc.filename} />
            )}

            {!loading && url && cat === "image" && (
              <img src={url} alt={doc.filename} className="max-w-full rounded border" />
            )}

            {!loading && url && !["pdf", "image"].includes(cat) && (
              <div className="border rounded p-6 text-center text-sm text-muted-foreground space-y-3">
                <Icon className={`h-12 w-12 mx-auto ${colorFor(cat)}`} />
                <p>Aperçu inline non disponible pour ce type de fichier.</p>
                <Button variant="outline" size="sm" asChild>
                  <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" />Ouvrir dans un onglet</a>
                </Button>
              </div>
            )}

            {doc.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{doc.description}</p>
              </div>
            )}

            {doc.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {doc.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
            )}

            {doc.is_sensitive && doc.sensitive_reason && (
              <div className="text-xs text-muted-foreground border-l-2 border-red-300 pl-3">
                <strong>Motif détection:</strong> {doc.sensitive_reason}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={downloadFile}>
                <Download className="h-4 w-4 mr-1" /> Télécharger
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <VaultPinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </>
  );
}
