import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Plus,
  Vote,
  Copy,
  ExternalLink,
  Users,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { MeetingDialog } from "@/components/meetings/meeting-dialog";
import { listSpacePolls } from "@/lib/collab.functions";

interface Props {
  spaceId: string;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: "Ouvert", className: "bg-emerald-100 text-emerald-800" },
  closed: { label: "Clôturé", className: "bg-muted text-muted-foreground" },
  confirmed: { label: "Confirmé", className: "bg-blue-100 text-blue-800" },
};

export function SpacePollsTab({ spaceId }: Props) {
  const listFn = useServerFn(listSpacePolls);
  const qc = useQueryClient();
  const queryKey = ["space-polls", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const polls = data?.polls ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ["space-meetings", spaceId] }),
      qc.invalidateQueries({ queryKey: ["space-links", spaceId] }),
    ]);

  const openNew = () => {
    setEditingMeetingId(null);
    setDialogOpen(true);
  };

  const openEdit = (meetingId: string) => {
    setEditingMeetingId(meetingId);
    setDialogOpen(true);
  };

  const copyPublicLink = (token: string) => {
    const url = `${window.location.origin}/poll/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Lien copié");
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Sondages de créneaux</h2>
          <Badge variant="secondary">{polls.length}</Badge>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nouveau sondage
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : polls.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border rounded-md">
          Aucun sondage de créneau pour cet espace.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Créer un sondage
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {polls.map((p) => {
            const isConfirmed = !!p.confirmed_slot_id;
            const statusKey = isConfirmed ? "confirmed" : p.status;
            const meta = STATUS_META[statusKey] ?? {
              label: p.status,
              className: "bg-muted",
            };
            return (
              <Card
                key={p.id}
                className="p-3 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-2">
                  <Vote className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        className="font-medium text-sm truncate cursor-pointer hover:underline"
                        onClick={() => openEdit(p.meeting_id)}
                      >
                        {p.title || p.meeting_title || "Sans titre"}
                      </h3>
                      <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                        {isConfirmed && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                        {meta.label}
                      </Badge>
                    </div>
                    {p.deadline && (
                      <div className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Avant le {format(new Date(p.deadline), "d MMM yyyy · HH:mm", { locale: fr })}
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{p.slots_count} créneau{p.slots_count > 1 ? "x" : ""}</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {p.voters_count} votant{p.voters_count > 1 ? "s" : ""}
                      </span>
                      <span>{p.votes_count} vote{p.votes_count > 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => copyPublicLink(p.public_token)}
                      >
                        <Copy className="h-3 w-3 mr-1" /> Copier le lien
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        asChild
                      >
                        <a
                          href={`/poll/${p.public_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3 w-3 mr-1" /> Ouvrir
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        meetingId={editingMeetingId}
        onSaved={() => {
          setDialogOpen(false);
          refresh();
        }}
        initialPollMode={!editingMeetingId}
      />
    </div>
  );
}
