import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listAvailableTemplates,
  deleteTemplate,
} from "@/lib/collab-templates.functions";
import { createCollabDocument } from "@/lib/collab-documents.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, FilePieChart, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

interface Tpl {
  id: string;
  title: string;
  template_scope: string;
  updated_at: string;
}

export function TemplatesDialog({
  spaceId,
  open,
  onOpenChange,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const listFn = useServerFn(listAvailableTemplates);
  const createFn = useServerFn(createCollabDocument);
  const deleteFn = useServerFn(deleteTemplate);
  const [loading, setLoading] = useState(false);
  const [personal, setPersonal] = useState<Tpl[]>([]);
  const [spaceTpl, setSpaceTpl] = useState<Tpl[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { spaceId } });
      setPersonal(res.personal as Tpl[]);
      setSpaceTpl(res.space as Tpl[]);
    } catch (e) {
      toast.error("Templates : chargement échoué", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spaceId]);

  const useTemplate = async (tpl: Tpl) => {
    setBusy(tpl.id);
    try {
      const res = await createFn({
        data: {
          spaceId,
          title: tpl.title.replace(/\s*\(template\)\s*$/i, ""),
          collabMode: "async",
          templateSourceId: tpl.id,
        },
      });
      toast.success("Document créé depuis le template");
      window.location.href = `/collaborate/space/${spaceId}/doc/${(res.document as { id: string }).id}`;
    } catch (e) {
      toast.error("Création échouée", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce template ?")) return;
    try {
      await deleteFn({ data: { templateId: id } });
      toast.success("Template supprimé");
      reload();
    } catch (e) {
      toast.error("Suppression échouée", { description: (e as Error).message });
    }
  };

  const renderList = (list: Tpl[]) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Chargement…
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <FilePieChart className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Aucun template disponible.
          <div className="mt-2 text-xs">
            Ouvre un document puis « Enregistrer comme template ».
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {list.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 border rounded-md p-3 hover:bg-muted/40"
          >
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{t.title}</div>
              <div className="text-xs text-muted-foreground">
                Mis à jour le{" "}
                {new Date(t.updated_at).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => useTemplate(t)}
              disabled={busy === t.id}
            >
              {busy === t.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Utiliser"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => handleDelete(t.id)}
              title="Supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Templates de documents</DialogTitle>
          <DialogDescription>
            Crée un nouveau document à partir d'un template existant.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="space">
          <TabsList>
            <TabsTrigger value="space">Espace ({spaceTpl.length})</TabsTrigger>
            <TabsTrigger value="personal">
              Personnels ({personal.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="space" className="mt-3 max-h-[55vh] overflow-y-auto">
            {renderList(spaceTpl)}
          </TabsContent>
          <TabsContent
            value="personal"
            className="mt-3 max-h-[55vh] overflow-y-auto"
          >
            {renderList(personal)}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
