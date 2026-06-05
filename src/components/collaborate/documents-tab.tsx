import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  listSpaceDocuments,
  createCollabDocument,
  deleteCollabDocument,
  duplicateCollabDocument,
} from "@/lib/collab-documents.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Plus,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  Copy,
  Trash2,
  FileSpreadsheet,
  FilePieChart,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface DocRow {
  id: string;
  title: string;
  doc_type: string;
  collab_mode: string;
  is_template: boolean;
  office_provider: string | null;
  office_url: string | null;
  office_thumbnail_url: string | null;
  version_count: number;
  unresolved_comments: number;
  last_edited_at: string;
  updated_at: string;
  created_at: string;
}

export function DocumentsTab({ spaceId }: { spaceId: string }) {
  const listFn = useServerFn(listSpaceDocuments);
  const createFn = useServerFn(createCollabDocument);
  const deleteFn = useServerFn(deleteCollabDocument);
  const duplicateFn = useServerFn(duplicateCollabDocument);

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "grid">("grid");
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { spaceId } });
      setDocs(res.documents as DocRow[]);
    } catch (e) {
      toast.error("Chargement échoué", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createFn({
        data: { spaceId, title: "Document sans titre", collabMode: "async" },
      });
      toast.success("Document créé");
      // Navigate by full page so we don't fight router types
      window.location.href = `/collaborate/space/${spaceId}/doc/${(res.document as { id: string }).id}`;
    } catch (e) {
      toast.error("Création échouée", { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce document ?")) return;
    try {
      await deleteFn({ data: { documentId: id } });
      toast.success("Document supprimé");
      reload();
    } catch (e) {
      toast.error("Suppression échouée", { description: (e as Error).message });
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateFn({ data: { documentId: id } });
      toast.success("Document dupliqué");
      reload();
    } catch (e) {
      toast.error("Duplication échouée", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setView("grid")}
            title="Vue grille"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setView("list")}
            title="Vue liste"
          >
            <ListIcon className="h-4 w-4" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Nouveau document
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={handleCreate}>
              <FileText className="h-4 w-4 mr-2" />
              📝 Document natif MyHub Pro
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled
              onClick={() => toast.info("Office 365 : phase 4")}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              📊 Lier un fichier Office 365
              <span className="ml-auto text-xs text-muted-foreground">phase 4</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled
              onClick={() => toast.info("Templates : phase 4")}
            >
              <FilePieChart className="h-4 w-4 mr-2" />
              📋 Depuis un template
              <span className="ml-auto text-xs text-muted-foreground">phase 4</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Chargement des documents…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 border rounded-md text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          Aucun document dans cet espace.
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Créer le premier document
            </Button>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <DocCard
              key={d.id}
              doc={d}
              spaceId={spaceId}
              onDelete={() => handleDelete(d.id)}
              onDuplicate={() => handleDuplicate(d.id)}
            />
          ))}
        </div>
      ) : (
        <div className="border rounded-md divide-y">
          {docs.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              spaceId={spaceId}
              onDelete={() => handleDelete(d.id)}
              onDuplicate={() => handleDuplicate(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocBadges({ doc }: { doc: DocRow }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Badge
        variant="outline"
        className={
          doc.collab_mode === "realtime"
            ? "border-green-500/40 text-green-600 dark:text-green-400 text-[10px]"
            : "text-[10px]"
        }
      >
        {doc.collab_mode === "realtime" ? "Temps réel" : "Asynchrone"}
      </Badge>
      {doc.doc_type === "office" && (
        <Badge variant="outline" className="text-[10px]">
          📎 Office 365
        </Badge>
      )}
      {doc.is_template && (
        <Badge variant="outline" className="text-[10px]">
          📋 Template
        </Badge>
      )}
    </div>
  );
}

function DocCard({
  doc,
  spaceId,
  onDelete,
  onDuplicate,
}: {
  doc: DocRow;
  spaceId: string;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <Card className="group relative hover:border-primary/40 transition">
      <Link
        // typed router would require generated route — use plain href
        to="/collaborate/space/$spaceId/doc/$docId"
        params={{ spaceId, docId: doc.id }}
        className="block"
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-start gap-2 text-base">
            <FileText className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{doc.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-xs text-muted-foreground mb-2">
            Modifié le{" "}
            {new Date(doc.last_edited_at).toLocaleDateString("fr-FR", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · v{doc.version_count}
          </div>
          <DocBadges doc={doc} />
        </CardContent>
      </Link>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4 mr-2" />
              Dupliquer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

function DocRow({
  doc,
  spaceId,
  onDelete,
  onDuplicate,
}: {
  doc: DocRow;
  spaceId: string;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 group">
      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
      <Link
        to="/collaborate/space/$spaceId/doc/$docId"
        params={{ spaceId, docId: doc.id }}
        className="flex-1 min-w-0 flex items-center gap-3"
      >
        <span className="font-medium truncate">{doc.title}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          v{doc.version_count} ·{" "}
          {new Date(doc.last_edited_at).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
          })}
        </span>
        <div className="ml-auto shrink-0">
          <DocBadges doc={doc} />
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy className="h-4 w-4 mr-2" />
            Dupliquer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
