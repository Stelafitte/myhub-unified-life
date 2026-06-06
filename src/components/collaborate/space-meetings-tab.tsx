import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Link2, Video, MapPin, CalendarClock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { MeetingDialog } from "@/components/meetings/meeting-dialog";
import { LinkPickerDialog } from "./link-picker-dialog";
import { listSpaceMeetings, linkEntityToSpace, unlinkEntity } from "@/lib/collab.functions";
import { confirmDialog } from "@/lib/confirm-dialog";

interface Props {
  spaceId: string;
}

type SpaceMeeting = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  location: string | null;
  is_online: boolean;
  online_link: string | null;
  status: string;
  organizer_name: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Planifiée",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  completed: "Terminée",
  poll: "Sondage",
};

export function SpaceMeetingsTab({ spaceId }: Props) {
  const listFn = useServerFn(listSpaceMeetings);
  const linkFn = useServerFn(linkEntityToSpace);
  const unlinkFn = useServerFn(unlinkEntity);
  const qc = useQueryClient();
  const queryKey = ["space-meetings", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const meetings = (data?.meetings ?? []) as SpaceMeeting[];
  const linkByMeetingId = data?.linkByMeetingId ?? {};

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pollMode, setPollMode] = useState(false);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ["space-links", spaceId] }),
    ]);

  const openNew = (asPoll = false) => {
    setEditingId(null);
    setPollMode(asPoll);
    setDialogOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setPollMode(false);
    setDialogOpen(true);
  };

  const onSaved = async (id?: string) => {
    setDialogOpen(false);
    if (!editingId && id) {
      try {
        await linkFn({ data: { spaceId, entityType: "meeting", entityId: id } });
        toast.success("Réunion créée et liée");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur de liaison");
      }
    }
    refresh();
  };

  const remove = async (m: SpaceMeeting) => {
    if (!(await confirmDialog(`Délier "${m.title}" de cet espace ?`))) return;
    const linkId = linkByMeetingId[m.id];
    if (!linkId) return;
    try {
      await unlinkFn({ data: { linkId } });
      toast.success("Réunion déliée");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Réunions de l'espace</h2>
          <Badge variant="secondary">{meetings.length}</Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Lier une réunion existante
          </Button>
          <Button size="sm" variant="outline" onClick={() => openNew(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Sondage de créneau
          </Button>
          <Button size="sm" onClick={() => openNew(false)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle réunion
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border rounded-md">
          Aucune réunion liée à cet espace.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {meetings.map((m) => {
            const start = new Date(m.start_at);
            const end = new Date(m.end_at);
            return (
              <Card
                key={m.id}
                className="p-3 hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => openEdit(m.id)}
              >
                <div className="flex items-start gap-2">
                  <CalendarClock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{m.title}</h3>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABEL[m.status] ?? m.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {format(start, "d MMM yyyy · HH:mm", { locale: fr })} → {format(end, "HH:mm")}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      {m.is_online && m.online_link && (
                        <span className="inline-flex items-center gap-1">
                          <Video className="h-3 w-3" /> En ligne
                        </span>
                      )}
                      {m.location && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3" /> {m.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(m);
                    }}
                    title="Délier"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        meetingId={editingId}
        onSaved={onSaved}
        initialPollMode={pollMode}
      />

      <LinkPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        spaceId={spaceId}
        restrictTypes={["meeting"]}
      />
    </div>
  );
}
