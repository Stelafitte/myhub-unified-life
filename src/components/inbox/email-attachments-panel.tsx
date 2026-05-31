import { useEffect, useState } from "react";
import { Paperclip, Folder, Download, Loader2, FolderPlus, Eye, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { type DocumentRow, getSignedUrl } from "@/lib/documents";
import { iconFor, colorFor, categorize, formatBytes } from "@/lib/file-icons";
import { SaveToFolderDialog } from "@/components/documents/save-to-folder-dialog";
import { AttachmentViewerDialog } from "@/components/inbox/attachment-viewer-dialog";
import { DownloadOptionsDialog } from "@/components/inbox/download-options-dialog";

type Props = {
  emailId: string;
  fromAddress: string | null;
  subject: string | null;
};

export function EmailAttachmentsPanel({ emailId, fromAddress, subject }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<DocumentRow | null>(null);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [download, setDownload] = useState<DocumentRow | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("source_type", "email")
      .eq("source_id", emailId)
      .order("created_at", { ascending: false });
    setDocs((data as DocumentRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [emailId]);

  async function openNative(d: DocumentRow) {
    if (!d.storage_path) return;
    try {
      const url = await getSignedUrl(d.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ouverture impossible");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Chargement des pièces jointes…
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <Paperclip className="mr-1 inline h-3 w-3" /> Cet email contient des pièces jointes (relance une synchronisation complète pour les récupérer).
      </div>
    );
  }

  return (
    <>
      <div className="border-b bg-muted/30 px-4 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Paperclip className="h-3 w-3" /> {docs.length} pièce{docs.length > 1 ? "s" : ""} jointe{docs.length > 1 ? "s" : ""}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {docs.map((d) => {
            const cat = categorize(d.mime_type, d.filename);
            const Icon = iconFor(cat);
            const folder = d.tags?.[0];
            return (
              <div key={d.id} className="group flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
                <Icon className={`h-4 w-4 ${colorFor(cat)}`} />
                <div className="flex flex-col">
                  <span className="font-medium leading-tight">{d.original_filename}</span>
                  <span className="text-[10px] text-muted-foreground">{formatBytes(d.file_size)}</span>
                </div>
                {folder ? (
                  <Badge variant="secondary" className="ml-1 gap-1 text-[10px]">
                    <Folder className="h-3 w-3" /> {folder}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() => setPick(d)}
                  title={folder ? "Reclasser" : "Classer dans un dossier"}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
                {d.storage_path && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setPreview(d)} title="Aperçu dans la liseuse">
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                {d.storage_path && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => openNative(d)} title="Ouvrir avec l'application native">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
                {d.storage_path && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setDownload(d)} title="Télécharger (local ou OneDrive)">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {pick && (
        <SaveToFolderDialog
          open={!!pick}
          onOpenChange={(v) => !v && setPick(null)}
          documents={[pick]}
          context={{ fromAddress, subject }}
          onSaved={() => { setPick(null); void load(); }}
        />
      )}
      <AttachmentViewerDialog
        doc={preview}
        open={!!preview}
        onOpenChange={(v) => !v && setPreview(null)}
      />
      <DownloadOptionsDialog
        doc={download}
        open={!!download}
        onOpenChange={(v) => !v && setDownload(null)}
        context={{ fromAddress, subject, emailId }}
      />
    </>
  );
}
