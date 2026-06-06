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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listSpaceLinks, unlinkEntity } from "@/lib/collab.functions";
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

export function SpaceLinksTab({ spaceId }: Props) {
  const listFn = useServerFn(listSpaceLinks);
  const unlinkFn = useServerFn(unlinkEntity);
  const qc = useQueryClient();
  const queryKey = ["space-links", spaceId];
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => unlinkFn({ data: { linkId } }),
    onSuccess: () => {
      toast.success("Lien supprimé");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const links = (data?.links ?? []) as LinkRow[];
  if (links.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        Aucune entité liée à cet espace.
        <div className="text-xs mt-1">
          Lie un email, une tâche, une réunion ou un document depuis son menu d'action.
        </div>
      </div>
    );
  }

  const grouped = links.reduce<Record<string, LinkRow[]>>((acc, l) => {
    (acc[l.entity_type] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-6">
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
    </div>
  );
}
