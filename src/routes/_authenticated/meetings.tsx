import { useCallback, useEffect, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Video, MapPin, Users as UsersIcon, CheckCircle2, XCircle, Clock, HelpCircle, Loader2, Mail, Download, Pencil, BarChart3, AlarmClock, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cacheGetAll, cacheReplaceAll } from "@/lib/local-cache";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { MeetingDialog } from "@/components/meetings/meeting-dialog";
import { downloadIcs } from "@/lib/ics";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

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
  confirmed_slot_id?: string | null;
};

type Participant = {
  id: string;
  meeting_id: string;
  email: string;
  name: string | null;
  role: string;
  rsvp_status: string;
};

type PollInfo = {
  id: string;
  meeting_id: string;
  status: string;
  deadline: string | null;
  public_token: string;
  voteCount: number;
  voterCount: number;
};

function MeetingsPage() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [pollsByMeeting, setPollsByMeeting] = useState<Record<string, PollInfo>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cached = await cacheGetAll<Meeting>("meetings");
    if (cached.length) { setMeetings(cached); setLoading(false); }
    if (!navigator.onLine) { setLoading(false); return; }
    const [m, p, t, polls, votes] = await Promise.all([
      supabase.from("meetings").select("*").order("start_at", { ascending: false }),
      supabase.from("meeting_participants").select("*"),
      supabase.from("meeting_tasks").select("meeting_id"),
      supabase.from("meeting_polls").select("id, meeting_id, status, deadline, public_token"),
      supabase.from("meeting_poll_votes").select("poll_id, voter_email"),
    ]);
    const meetingsList = (m.data as Meeting[]) ?? [];
    setMeetings(meetingsList);
    cacheReplaceAll("meetings", meetingsList).catch(() => {});
    setParticipants((p.data as Participant[]) ?? []);
    const counts: Record<string, number> = {};
    ((t.data ?? []) as { meeting_id: string }[]).forEach((row) => {
      counts[row.meeting_id] = (counts[row.meeting_id] ?? 0) + 1;
    });
    setTaskCounts(counts);

    const voteRows = (votes.data ?? []) as { poll_id: string; voter_email: string }[];
    const voteAgg: Record<string, { total: number; voters: Set<string> }> = {};
    voteRows.forEach((v) => {
      const a = voteAgg[v.poll_id] ?? (voteAgg[v.poll_id] = { total: 0, voters: new Set() });
      a.total += 1;
      a.voters.add((v.voter_email ?? "").toLowerCase());
    });
    const pollMap: Record<string, PollInfo> = {};
    ((polls.data ?? []) as { id: string; meeting_id: string; status: string; deadline: string | null; public_token: string }[]).forEach((pl) => {
      const agg = voteAgg[pl.id];
      pollMap[pl.meeting_id] = {
        id: pl.id,
        meeting_id: pl.meeting_id,
        status: pl.status,
        deadline: pl.deadline,
        public_token: pl.public_token,
        voteCount: agg?.total ?? 0,
        voterCount: agg?.voters.size ?? 0,
      };
    });
    setPollsByMeeting(pollMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onOnline = () => load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const now = useMemo(() => new Date(), []);
  const upcoming = meetings.filter((m) => new Date(m.end_at) >= now && m.status !== "cancelled");
  const past = meetings.filter((m) => new Date(m.end_at) < now || m.status === "completed");
  const myEmail = user?.email?.toLowerCase();
  const invitations = meetings.filter((m) => {
    const mine = participants.find((x) => x.meeting_id === m.id && x.email.toLowerCase() === myEmail && x.role !== "organizer");
    return mine?.rsvp_status === "pending";
  });

  const openNew = () => { setEditId(null); setDialogOpen(true); };
  const openEdit = (id: string) => { setEditId(id); setDialogOpen(true); };

  async function rsvp(meetingId: string, status: "accepted" | "declined" | "tentative") {
    if (!myEmail) return;
    const { error } = await supabase
      .from("meeting_participants")
      .update({ rsvp_status: status, responded_at: new Date().toISOString() })
      .eq("meeting_id", meetingId)
      .eq("email", myEmail);
    if (error) { toast.error(error.message); return; }
    toast.success("Réponse enregistrée");
    load();
  }

  function exportIcs(m: Meeting) {
    const ps = participants.filter((p) => p.meeting_id === m.id && p.role !== "organizer");
    downloadIcs({
      uid: `${m.id}@myhubpro`,
      title: m.title,
      description: m.description,
      location: m.is_online ? m.online_link ?? m.location : m.location,
      startAt: new Date(m.start_at),
      endAt: new Date(m.end_at),
      organizer: m.organizer_email ? { email: m.organizer_email, name: m.organizer_name } : null,
      participants: ps.map((p) => ({ email: p.email, name: p.name, role: (p.role as "required" | "optional") })),
      url: m.is_online ? m.online_link : null,
    });
  }

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
        <Button onClick={openNew}>＋ Nouvelle réunion</Button>
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
          <MeetingList loading={loading} meetings={upcoming} participants={participants} taskCounts={taskCounts} pollsByMeeting={pollsByMeeting} empty="Aucune réunion à venir." onEdit={openEdit} onExport={exportIcs} myEmail={myEmail} onRsvp={rsvp} />
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          <MeetingList loading={loading} meetings={past} participants={participants} taskCounts={taskCounts} pollsByMeeting={pollsByMeeting} empty="Aucune réunion passée." onEdit={openEdit} onExport={exportIcs} myEmail={myEmail} onRsvp={rsvp} />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <MeetingList loading={loading} meetings={invitations} participants={participants} taskCounts={taskCounts} pollsByMeeting={pollsByMeeting} empty="Aucune invitation en attente." onEdit={openEdit} onExport={exportIcs} myEmail={myEmail} onRsvp={rsvp} showRsvp />
        </TabsContent>
      </Tabs>

      <MeetingDialog open={dialogOpen} onOpenChange={setDialogOpen} meetingId={editId} onSaved={load} />
    </div>
  );
}

function MeetingList({
  loading,
  meetings,
  participants,
  taskCounts,
  pollsByMeeting,
  empty,
  onEdit,
  onExport,
  myEmail,
  onRsvp,
  showRsvp,
}: {
  loading: boolean;
  meetings: Meeting[];
  participants: Participant[];
  taskCounts: Record<string, number>;
  pollsByMeeting: Record<string, PollInfo>;
  empty: string;
  onEdit: (id: string) => void;
  onExport: (m: Meeting) => void;
  myEmail?: string;
  onRsvp: (id: string, status: "accepted" | "declined" | "tentative") => void;
  showRsvp?: boolean;
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
      {meetings.map((m) => {
        const ps = participants.filter((p) => p.meeting_id === m.id);
        const mine = myEmail ? ps.find((p) => p.email.toLowerCase() === myEmail) : undefined;
        return (
          <MeetingCard
            key={m.id}
            meeting={m}
            participants={ps}
            taskCount={taskCounts[m.id] ?? 0}
            poll={pollsByMeeting[m.id]}
            onEdit={() => onEdit(m.id)}
            onExport={() => onExport(m)}
            myRsvp={mine?.rsvp_status}
            isOrganizer={mine?.role === "organizer"}
            showRsvp={showRsvp}
            onRsvp={(s) => onRsvp(m.id, s)}
          />
        );
      })}
    </div>
  );
}

function MeetingCard({
  meeting,
  participants,
  taskCount,
  poll,
  onEdit,
  onExport,
  myRsvp,
  isOrganizer,
  showRsvp,
  onRsvp,
}: {
  meeting: Meeting;
  participants: Participant[];
  taskCount: number;
  poll?: PollInfo;
  onEdit: () => void;
  onExport: () => void;
  myRsvp?: string;
  isOrganizer?: boolean;
  showRsvp?: boolean;
  onRsvp: (status: "accepted" | "declined" | "tentative") => void;
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

  const isConfirmed = meeting.status === "scheduled" && !!meeting.confirmed_slot_id;
  const pollOpen = poll?.status === "open";
  const deadlineDate = poll?.deadline ? new Date(poll.deadline) : null;
  const hoursToDeadline = deadlineDate ? Math.round((deadlineDate.getTime() - Date.now()) / 3600000) : null;
  const hoursToStart = Math.round((start.getTime() - Date.now()) / 3600000);
  const showReminder = !pollOpen && hoursToStart > 0 && (hoursToStart <= 48) && counts.pending > 0;

  function copyPollLink() {
    if (!poll) return;
    const url = `${window.location.origin}/poll/${poll.public_token}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Lien du sondage copié"));
  }

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{meeting.title}</h3>
            <StatusBadge status={meeting.status} />
            {isConfirmed && (
              <Badge variant="outline" className="gap-1 border-green-300 text-green-700 dark:text-green-300">
                <CheckCircle2 className="h-3 w-3" /> Confirmée
              </Badge>
            )}
            {pollOpen && (
              <Badge variant="outline" className="gap-1 border-violet-300 text-violet-700 dark:text-violet-300">
                <BarChart3 className="h-3 w-3" /> Sondage ouvert · {poll!.voterCount} votant{poll!.voterCount > 1 ? "s" : ""}
              </Badge>
            )}
            {pollOpen && hoursToDeadline !== null && hoursToDeadline >= 0 && hoursToDeadline <= 24 && (
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:text-amber-300">
                <AlarmClock className="h-3 w-3" /> Deadline dans {hoursToDeadline}h
              </Badge>
            )}
            {meeting.is_online && (
              <Badge variant="outline" className="gap-1">
                <Video className="h-3 w-3" />
                {meeting.online_provider ?? "Visio"}
              </Badge>
            )}
            {myRsvp && myRsvp !== "pending" && !isOrganizer && (
              <Badge variant="outline" className="text-xs">Vous: {myRsvp}</Badge>
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
          {showRsvp && !isOrganizer && (
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="text-green-600" onClick={() => onRsvp("accepted")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Accepter
              </Button>
              <Button size="sm" variant="outline" className="text-amber-600" onClick={() => onRsvp("tentative")}>
                <HelpCircle className="h-3.5 w-3.5 mr-1" /> Peut-être
              </Button>
              <Button size="sm" variant="outline" className="text-red-600" onClick={() => onRsvp("declined")}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Refuser
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {meeting.is_online && meeting.online_link && (
            <Button asChild size="sm" variant="outline">
              <a href={meeting.online_link} target="_blank" rel="noreferrer">Rejoindre</a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Éditer
          </Button>
          <Button size="sm" variant="ghost" onClick={onExport}>
            <Download className="h-3.5 w-3.5 mr-1" /> .ics
          </Button>
        </div>
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
