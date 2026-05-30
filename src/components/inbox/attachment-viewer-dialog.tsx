import { useEffect, useState } from "react";
import { Loader2, Download, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getSignedUrl, type DocumentRow } from "@/lib/documents";
import { categorize } from "@/lib/file-icons";
import { toast } from "sonner";

type Props = {
  doc: DocumentRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function AttachmentViewerDialog({ doc, open, onOpenChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cat = doc ? categorize(doc.mime_type, doc.filename) : "other";

  useEffect(() => {
    if (!open || !doc?.storage_path) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setUrl(null);
      setText(null);
      try {
        const u = await getSignedUrl(doc.storage_path!);
        if (cancelled) return;
        setUrl(u);
        if (cat === "text" || cat === "code") {
          try {
            const r = await fetch(u);
            const t = await r.text();
            if (!cancelled) setText(t.slice(0, 200_000));
          } catch { /* ignore */ }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Aperçu indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, doc, cat]);

  function openNative() {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  function renderBody() {
    if (loading || !url) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
        </div>
      );
    }
    if (cat === "pdf") {
      return <iframe src={url} className="h-full w-full" title={doc?.original_filename ?? "PDF"} />;
    }
    if (cat === "image") {
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-2">
          <img src={url} alt={doc?.original_filename ?? ""} className="max-h-full max-w-full object-contain" />
        </div>
      );
    }
    if (cat === "video") {
      return <video src={url} controls className="h-full w-full bg-black" />;
    }
    if (cat === "audio") {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <audio src={url} controls className="w-full" />
        </div>
      );
    }
    if (cat === "text" || cat === "code") {
      return (
        <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words bg-muted/30 p-4 text-xs">
          {text ?? ""}
        </pre>
      );
    }
    if (cat === "word" || cat === "excel" || ["pptx", "ppt", "odp"].includes((doc?.filename ?? "").split(".").pop()?.toLowerCase() ?? "")) {
      const viewer = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            Aperçu via Google Docs (lecture seule). Pour modifier, ouvrez avec l'application native.
          </div>
          <iframe src={viewer} className="h-full w-full" title={doc?.original_filename ?? "Document"} />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>Aperçu non disponible pour ce type de fichier.</p>
        <Button onClick={openNative}>
          <Download className="mr-2 h-4 w-4" /> Télécharger
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <DialogTitle className="truncate text-sm">{doc?.original_filename ?? "Pièce jointe"}</DialogTitle>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={openNative} disabled={!url} title="Ouvrir dans l'application native">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Application native
            </Button>
            <Button size="sm" variant="outline" onClick={openNative} disabled={!url} title="Télécharger">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Télécharger
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1">{renderBody()}</div>
      </DialogContent>
    </Dialog>
  );
}
