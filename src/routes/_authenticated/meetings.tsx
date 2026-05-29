import { useEffect, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Video, MapPin, Users as UsersIcon, CheckCircle2, XCircle, Clock, HelpCircle, Loader2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: MeetingsPage,
});

type Meeting = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  location: string | null;
  is_online: boolean;
  online_link: string | null;
  online_provider: string | null;
  status: string;
  organizer_email: string | null;
  organizer_name: string | null;
};

type Participant = {
  id: string;
  meeting_id: string;
  email: string;
  name: string | null;
  role: string;
  rsvp_status: string;
};

function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [m, p, t] = await Promise.all([
        supabase.from("meetings").select("*").order("start_at", { ascending: false }),
        supabase.from("meeting_participants").select("*"),
        supabase.from("meeting_tasks").select("meeting_id"),
      ]);
      if (!active) return;
      setMeetings((m.data as Meeting[]) ?? []);
      setParticipants((p.data as Participant[]) ?? []);
      const counts: Record<string, number> = {};
      ((t.data ?? []) as { meeting_id: string }[]).forEach((row) => {
        counts[row.meeting_id] = (counts[row.meeting_id] ?? 0) + 1;
      });
      setTaskCounts(counts);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const now = useMemo(() => new Date(), []);
  const upcoming = meetings.filter((m) => new Date(m.end_at) >= now && m.status !== "cancelled");
  const past = meetings.filter((m) => new Date(m.end_at) < now || m.status === "completed");
  const invitations = meetings.filter((m) => {
    const p = participants.find((x) => x.meeting_id === m.id && x.role !== "organizer");
    return p?.rsvp_status === "pending";
  });

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6" />
            Réunions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Planifiez, suivez et débriefez vos réunions.
          </p>
        </div>
        <Button disabled title="Disponible en Phase 2">＋ Nouvelle réunion</Button>
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList>
          <TabsTrigger value="upcoming">
            À venir <Badge variant="secondary" className="ml-2">{upcoming.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="past">
            Passées <Badge variant="secondary" className="ml-2">{past.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations <Badge variant="secondary" className="ml-2">{invitations.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          <MeetingList loading={loading} meetings={upcoming} participants={participants} taskCounts={taskCounts} empty="Aucune réunion à venir." />
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          <MeetingList loading={loading} meetings={past} participants={participants} taskCounts={taskCounts} empty="Aucune réunion passée." />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <MeetingList loading={loading} meetings={invitations} participants={participants} taskCounts={taskCounts} empty="Aucune invitation en attente." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MeetingList({
  loading,
  meetings,
  participants,
  taskCounts,
  empty,
}: {
  loading: boolean;
  meetings: Meeting[];
  participants: Participant[];
  taskCounts: Record<string, number>;
  empty: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }
  if (meetings.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
        {empty}
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {meetings.map((m) => (
        <MeetingCard
          key={m.id}
          meeting={m}
          participants={participants.filter((p) => p.meeting_id === m.id)}
          taskCount={taskCounts[m.id] ?? 0}
        />
      ))}
    </div>
  );
}

function MeetingCard({
  meeting,
  participants,
  taskCount,
}: {
  meeting: Meeting;
  participants: Participant[];
  taskCount: number;
}) {
  const start = new Date(meeting.start_at);
  const end = new Date(meeting.end_at);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
  const counts = {
    accepted: participants.filter((p) => p.rsvp_status === "accepted").length,
    declined: participants.filter((p) => p.rsvp_status === "declined").length,
    tentative: participants.filter((p) => p.rsvp_status === "tentative").length,
    pending: participants.filter((p) => p.rsvp_status === "pending").length,
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{meeting.title}</h3>
            <StatusBadge status={meeting.status} />
            {meeting.is_online && (
              <Badge variant="outline" className="gap-1">
                <Video className="h-3 w-3" />
                {meeting.online_provider ?? "Visio"}
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {format(start, "EEE d MMM, HH:mm", { locale: fr })} · {durationMin} min
            </span>
            {meeting.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {meeting.location}
              </span>
            )}
          </div>
          {meeting.description && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{meeting.description}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <UsersIcon className="h-3.5 w-3.5" />
              {participants.length}
            </span>
            {counts.accepted > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {counts.accepted}
              </span>
            )}
            {counts.declined > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="h-3.5 w-3.5" />
                {counts.declined}
              </span>
            )}
            {counts.tentative > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <HelpCircle className="h-3.5 w-3.5" />
                {counts.tentative}
              </span>
            )}
            {counts.pending > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {counts.pending}
              </span>
            )}
            {taskCount > 0 && (
              <span className="ml-auto text-muted-foreground">
                {taskCount} tâche{taskCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        {meeting.is_online && meeting.online_link && (
          <Button asChild size="sm" variant="outline">
            <a href={meeting.online_link} target="_blank" rel="noreferrer">
              Rejoindre
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    scheduled: { label: "Planifiée", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
    ongoing: { label: "En cours", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
    completed: { label: "Terminée", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
    cancelled: { label: "Annulée", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  };
  const s = map[status] ?? map.scheduled;
  return <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", s.cls)}>{s.label}</span>;
}
