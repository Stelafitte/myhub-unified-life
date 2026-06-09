import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Mail,
  CheckSquare,
  CalendarClock,
  FileText,
  User,
  X,
  Loader2,
  Link2,
  Plus,
  Globe,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listSpaceLinks,
  unlinkEntity,
  listSpaceUrlLinks,
  createSpaceUrlLink,
  deleteSpaceUrlLink,
} from "@/lib/collab.functions";
import { LinkPickerDialog } from "./link-picker-dialog";

interface Props {
  spaceId: string;
}

const ICONS: Record<string, typeof Mail> = {
  email: Mail,
  task: CheckSquare,
  meeting: CalendarClock,
  document: FileText,
  contact: User,
};

const LABELS: Record<string, string> = {
  email: "Emails",
  task: "Tâches",
  meeting: "Réunions",
  document: "Documents",
  contact: "Contacts",
};

interface LinkRow {
  id: string;
  entity_type: keyof typeof LABELS;
  entity_id: string;
  note: string | null;
  created_at: string;
  entity: Record<string, unknown> | null;
}

function entityLabel(l: LinkRow): string {
  const e = l.entity as Record<string, string | null> | null;
  if (!e) return "(entité introuvable)";
  switch (l.entity_type) {
    case "email":
      return e.subject ?? e.from_address ?? "(email sans sujet)";
    case "task":
      return e.title ?? "(tâche)";
    case "meeting":
      return e.title ?? "(réunion)";
    case "document":
      return e.filename ?? "(document)";
    case "contact":
      return [e.first_name, e.last_name].filter(Boolean).join(" ") || e.organization || "(contact)";
    default:
      return l.entity_id;
  }
}

function entityHref(l: LinkRow): string | null {
  switch (l.entity_type) {
    case "email":
      return "/inbox";
    case "task":
      return "/tasks";
    case "meeting":
      return "/meetings";
    case "document":
      return "/documents";
    case "contact":
      return "/contacts";
    default:
      return null;
  }
}

interface UrlLink {
  id: string;
  title: string;
  url: string;
  note: string | null;
  created_at: string;
}

export function SpaceLinksTab({ spaceId }: Props) {
  const listFn = useServerFn(listSpaceLinks);
  const unlinkFn = useServerFn(unlinkEntity);
  const listUrlFn = useServerFn(listSpaceUrlLinks);
  const createUrlFn = useServerFn(createSpaceUrlLink);
  const deleteUrlFn = useServerFn(deleteSpaceUrlLink);
  const qc = useQueryClient();
  const queryKey = ["space-links", spaceId];
  const urlQueryKey = ["space-url-links", spaceId];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlTitle, setUrlTitle] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlNote, setUrlNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const { data: urlData, isLoading: urlLoading } = useQuery({
    queryKey: urlQueryKey,
    queryFn: () => listUrlFn({ data: { spaceId } }),
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => unlinkFn({ data: { linkId } }),
    onSuccess: () => {
      toast.success("Lien supprimé");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createUrl = useMutation({
    mutationFn: (vars: { title: string; url: string; note?: string }) =>
      createUrlFn({ data: { spaceId, title: vars.title, url: vars.url, note: vars.note } }),
    onSuccess: () => {
      toast.success("Lien ajouté");
      setUrlTitle("");
      setUrlValue("");
      setUrlNote("");
      setUrlDialogOpen(false);
      qc.invalidateQueries({ queryKey: urlQueryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeUrl = useMutation({
    mutationFn: (linkId: string) => deleteUrlFn({ data: { linkId } }),
    onSuccess: () => {
      toast.success("Lien supprimé");
      qc.invalidateQueries({ queryKey: urlQueryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const links = (data?.links ?? []) as LinkRow[];
  const grouped = links.reduce<Record<string, LinkRow[]>>((acc, l) => {
    (acc[l.entity_type] ??= []).push(l);
    return acc;
  }, {});

  const urlLinks = (urlData?.links ?? []) as UrlLink[];
  const hasAny = links.length > 0 || urlLinks.length > 0;
  const isAnyLoading = isLoading || urlLoading;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Entités liées</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setUrlDialogOpen(true)}>
            <Globe className="h-3.5 w-3.5 mr-1" /> Lien
          </Button>
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Lier
          </Button>
        </div>
      </div>

      {isAnyLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !hasAny ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          Aucune entité liée à cet espace.
          <div className="text-xs mt-1">
            Clique sur « Lier » pour rechercher et attacher un email, une tâche, une
            réunion, un contact ou un document. Clique sur « Lien » pour ajouter une URL externe.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, rows]) => {
            const Icon = ICONS[type] ?? Link2;
            return (
              <section key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{LABELS[type] ?? type}</h3>
                  <Badge variant="secondary">{rows.length}</Badge>
                </div>
                <div className="border rounded-md divide-y">
                  {rows.map((l) => {
                    const href = entityHref(l);
                    const content = (
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{entityLabel(l)}</div>
                        {l.note && (
                          <div className="text-xs text-muted-foreground truncate italic">
                            {l.note}
                          </div>
                        )}
                      </div>
                    );
                    return (
                      <div key={l.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                        {href ? (
                          <Link to={href} className="flex-1 min-w-0 hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => remove.mutate(l.id)}
                          title="Délier"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {urlLinks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Liens externes</h3>
                <Badge variant="secondary">{urlLinks.length}</Badge>
              </div>
              <div className="border rounded-md divide-y">
                {urlLinks.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 hover:underline"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-1">
                          {l.title}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </div>
                        {l.note && (
                          <div className="text-xs text-muted-foreground truncate italic">
                            {l.note}
                          </div>
                        )}
                      </div>
                    </a>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => removeUrl.mutate(l.id)}
                      title="Supprimer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <LinkPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} spaceId={spaceId} />

      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un lien externe</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Titre</label>
              <Input
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                placeholder="Nom du lien…"
              />
            </div>
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Note (optionnelle)</label>
              <Input
                value={urlNote}
                onChange={(e) => setUrlNote(e.target.value)}
                placeholder="Note…"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setUrlDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={() =>
                  createUrl.mutate({ title: urlTitle, url: urlValue, note: urlNote })
                }
                disabled={
                  !urlTitle.trim() || !urlValue.trim() || createUrl.isPending
                }
              >
                {createUrl.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Ajouter"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
