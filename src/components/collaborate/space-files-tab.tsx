import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Download,
  Trash2,
  Search,
  Loader2,
  Lock,
  Link2,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { listSpaceFiles, linkEntityToSpace, unlinkEntity } from "@/lib/collab.functions";
import {
  sha256,
  storagePath,
  uploadToStorage,
  downloadAsBlob,
  removeFromStorage,
  type DocumentRow,
} from "@/lib/documents";
import { categorize, iconFor, colorFor, formatBytes } from "@/lib/file-icons";
import { DocumentPreviewSheet } from "@/components/documents/document-preview-sheet";
import { LinkPickerDialog } from "./link-picker-dialog";
import { confirmDialog } from "@/lib/confirm-dialog";

type FileRow = {
  id: string;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string | null;
  is_sensitive: boolean;
  local_only: boolean;
  user_id: string;
  created_at: string;
  description: string | null;
  tags: string[];
};

export function SpaceFilesTab({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listSpaceFiles);
  const linkFn = useServerFn(linkEntityToSpace);
  const unlinkFn = useServerFn(unlinkEntity);

  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["space-files", spaceId],
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const files = (data?.files ?? []) as FileRow[];
  const linkMap = data?.linkByDocId ?? {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.original_filename.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q) ||
        f.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [files, search]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["space-files", spaceId] });
    qc.invalidateQueries({ queryKey: ["space-links", spaceId] });
  };

  const handleUpload = useCallback(
    async (list: FileList | null) => {
      if (!list || !user) return;
      const arr = Array.from(list);
      setUploading(true);
      try {
        for (const file of arr) {
          if (file.size > 50 * 1024 * 1024) {
            toast.error(`${file.name} dépasse 50 Mo`);
            continue;
          }
          const docId = crypto.randomUUID();
          const checksum = await sha256(file);
          const path = storagePath(user.id, "manual", docId, file.name);
          await uploadToStorage(path, file);
          const { error } = await supabase.from("documents").insert({
            id: docId,
            user_id: user.id,
            filename: file.name,
            original_filename: file.name,
            file_size: file.size,
            mime_type: file.type || null,
            storage_path: path,
            source_type: "manual",
            is_sensitive: false,
            local_only: false,
            checksum,
            tags: [],
          });
          if (error) throw error;
          await linkFn({
            data: { spaceId, entityType: "document", entityId: docId },
          });
        }
        toast.success(`${arr.length} fichier(s) ajouté(s)`);
        reload();
      } catch (e) {
        toast.error("Upload échoué", { description: (e as Error).message });
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, spaceId],
  );

  const handleDownload = async (f: FileRow) => {
    if (!f.storage_path) {
      toast.error("Fichier indisponible");
      return;
    }
    try {
      const blob = await downloadAsBlob(f.storage_path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.original_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Téléchargement échoué", { description: (e as Error).message });
    }
  };

  const handleDelete = async (f: FileRow) => {
    if (!user) return;
    const isAuthor = f.user_id === user.id;
    if (!isAuthor) {
      toast.error("Seul l'auteur peut supprimer ce fichier");
      return;
    }
    if (!(await confirmDialog(`Supprimer "${f.original_filename}" définitivement ?`))) return;
    try {
      if (f.storage_path) await removeFromStorage(f.storage_path).catch(() => {});
      const link = linkMap[f.id];
      if (link) await unlinkFn({ data: { linkId: link.linkId } });
      const { error } = await supabase.from("documents").delete().eq("id", f.id);
      if (error) throw error;
      toast.success("Fichier supprimé");
      reload();
    } catch (e) {
      toast.error("Suppression échouée", { description: (e as Error).message });
    }
  };

  const handleRemoveLink = async (f: FileRow) => {
    const link = linkMap[f.id];
    if (!link) return;
    try {
      await unlinkFn({ data: { linkId: link.linkId } });
      toast.success("Fichier retiré de l'espace");
      reload();
    } catch (e) {
      toast.error("Échec", { description: (e as Error).message });
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un fichier…"
            className="pl-8 h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Link2 className="h-4 w-4 mr-1" /> Lier un fichier
        </Button>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-1" />
          )}
          Téléverser
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleUpload(e.dataTransfer.files);
        }}
        className="border-2 border-dashed rounded-md p-4 text-center text-xs text-muted-foreground hover:border-primary/40 transition"
      >
        Glissez-déposez des fichiers ici pour les ajouter à cet espace
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border rounded-md text-muted-foreground text-sm">
          Aucun fichier dans cet espace.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((f) => {
            const cat = categorize(f.mime_type, f.original_filename);
            const Icon = iconFor(cat);
            const color = colorFor(cat);
            return (
              <div
                key={f.id}
                className="border rounded-md p-3 hover:border-primary/40 transition group flex flex-col gap-2"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <button
                    onClick={() => setPreviewDoc(f as unknown as DocumentRow)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="font-medium text-sm truncate">
                      {f.original_filename}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(f.file_size)} ·{" "}
                      {format(new Date(f.created_at), "d MMM yyyy", { locale: fr })}
                    </div>
                  </button>
                  {f.is_sensitive && (
                    <Badge variant="outline" className="text-[10px] gap-0.5">
                      <Lock className="h-3 w-3" /> Sensible
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleDownload(f)}
                    title="Télécharger"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleRemoveLink(f)}
                    title="Retirer de l'espace"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                  {user?.id === f.user_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive"
                      onClick={() => handleDelete(f)}
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DocumentPreviewSheet
        doc={previewDoc}
        onOpenChange={(v) => !v && setPreviewDoc(null)}
      />

      <LinkPickerDialog
        spaceId={spaceId}
        open={pickerOpen}
        onOpenChange={(v) => {
          setPickerOpen(v);
          if (!v) reload();
        }}
        restrictTypes={["document"]}
      />
    </div>
  );
}
