import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, HelpCircle, XCircle, Loader2, MapPin, Video, FileText, Download } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/poll/$token")({
  head: () => ({
    meta: [
      { title: "Sondage de réunion" },
      { name: "description", content: "Indiquez vos disponibilités pour cette réunion." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PollPage,
});

type Poll = {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: string;
  public_token: string;
};

type Slot = {
  id: string;
  start_at: string;
  end_at: string;
  position: number;
  is_online: boolean;
  online_provider: string | null;
  location: string | null;
};

type Vote = {
  id: string;
  slot_id: string;
  poll_id: string;
  voter_email: string;
  voter_name: string | null;
  vote: "yes" | "no" | "maybe" | string;
};

type Choice = "yes" | "maybe" | "no";

function PollPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: pollRow, error: pollErr } = await supabase
      .from("meeting_polls")
      .select("id,title,description,deadline,status,public_token")
      .eq("public_token", token)
      .maybeSingle();
    if (pollErr || !pollRow) {
      setPoll(null);
      setLoading(false);
      return;
    }
    setPoll(pollRow as Poll);
    const [{ data: slotRows }, { data: voteRows }] = await Promise.all([
      supabase
        .from("meeting_poll_slots")
        .select("id,start_at,end_at,position,is_online,online_provider,location")
        .eq("poll_id", pollRow.id)
        .order("position", { ascending: true }),
      supabase
        .from("meeting_poll_votes")
        .select("id,slot_id,poll_id,voter_email,voter_name,vote")
        .eq("poll_id", pollRow.id),
    ]);
    setSlots((slotRows as Slot[]) ?? []);
    setVotes((voteRows as Vote[]) ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // When the email matches an existing voter, prefill their previous choices.
  useEffect(() => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    const mine = votes.filter((v) => v.voter_email.toLowerCase() === e);
    if (mine.length === 0) return;
    const next: Record<string, Choice> = {};
    for (const v of mine) {
      next[v.slot_id] = (v.vote as Choice) ?? "yes";
    }
    setChoices((prev) => ({ ...next, ...prev }));
    const n = mine.find((m) => m.voter_name)?.voter_name;
    if (n && !name) setName(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, votes]);

  const counts = useMemo(() => {
    const out: Record<string, { yes: number; maybe: number; no: number }> = {};
    for (const s of slots) out[s.id] = { yes: 0, maybe: 0, no: 0 };
    for (const v of votes) {
      const c = out[v.slot_id];
      if (!c) continue;
      if (v.vote === "yes") c.yes++;
      else if (v.vote === "maybe") c.maybe++;
      else if (v.vote === "no") c.no++;
    }
    return out;
  }, [slots, votes]);

  const expired = poll?.deadline ? new Date(poll.deadline).getTime() < Date.now() : false;
  const closed = poll?.status === "closed" || expired;

  function setChoice(slotId: string, c: Choice) {
    setChoices((prev) => ({ ...prev, [slotId]: c }));
  }

  async function submit() {
    if (!poll) return;
    const e = email.trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      toast.error("Email invalide");
      return;
    }
    const picks = Object.entries(choices);
    if (picks.length === 0) {
      toast.error("Sélectionnez au moins un créneau");
      return;
    }
    setSaving(true);
    try {
      // Replace any previous votes from this email for this poll
      await supabase
        .from("meeting_poll_votes")
        .delete()
        .eq("poll_id", poll.id)
        .eq("voter_email", e);
      const rows = picks.map(([slot_id, vote]) => ({
        poll_id: poll.id,
        slot_id,
        voter_email: e,
        voter_name: name.trim() || null,
        vote,
        is_internal: false,
      }));
      const { error } = await supabase.from("meeting_poll_votes").insert(rows);
      if (error) throw error;
      toast.success("Réponses enregistrées, merci !");
      setSubmitted(true);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Impossible d'enregistrer : ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (!poll) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Sondage introuvable</h1>
          <p className="text-sm text-muted-foreground">
            Ce lien est invalide ou a été révoqué.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6" />
            {poll.title}
          </h1>
          {poll.description && (
            <p className="text-muted-foreground mt-2 whitespace-pre-line">{poll.description}</p>
          )}
          {poll.deadline && (
            <p className="text-xs text-muted-foreground mt-2">
              Date limite : {format(new Date(poll.deadline), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
            </p>
          )}
          {closed && (
            <Badge variant="destructive" className="mt-2">Sondage clôturé</Badge>
          )}
        </header>

        {!closed && !submitted && (
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">Votre email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                />
              </div>
              <div>
                <Label htmlFor="name">Votre nom</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optionnel"
                />
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-3">
          {slots.map((slot) => {
            const start = new Date(slot.start_at);
            const end = new Date(slot.end_at);
            const c = counts[slot.id] ?? { yes: 0, maybe: 0, no: 0 };
            const pick = choices[slot.id];
            return (
              <Card key={slot.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {format(start, "EEEE d MMM", { locale: fr })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(start, "HH:mm")} – {format(end, "HH:mm")}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                      {slot.is_online && (
                        <span className="flex items-center gap-1">
                          <Video className="h-3 w-3" />
                          {slot.online_provider ?? "Visio"}
                        </span>
                      )}
                      {slot.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {slot.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {c.yes}
                    </span>
                    <span className="flex items-center gap-1 text-amber-600">
                      <HelpCircle className="h-3.5 w-3.5" /> {c.maybe}
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3.5 w-3.5" /> {c.no}
                    </span>
                  </div>
                </div>

                {!closed && !submitted && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <Button
                      type="button"
                      variant={pick === "yes" ? "default" : "outline"}
                      size="sm"
                      className={cn(pick === "yes" && "bg-green-600 hover:bg-green-700")}
                      onClick={() => setChoice(slot.id, "yes")}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Oui
                    </Button>
                    <Button
                      type="button"
                      variant={pick === "maybe" ? "default" : "outline"}
                      size="sm"
                      className={cn(pick === "maybe" && "bg-amber-500 hover:bg-amber-600")}
                      onClick={() => setChoice(slot.id, "maybe")}
                    >
                      <HelpCircle className="h-4 w-4 mr-1" /> Peut-être
                    </Button>
                    <Button
                      type="button"
                      variant={pick === "no" ? "default" : "outline"}
                      size="sm"
                      className={cn(pick === "no" && "bg-red-600 hover:bg-red-700")}
                      onClick={() => setChoice(slot.id, "no")}
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Non
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          {slots.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              Aucun créneau proposé pour ce sondage.
            </Card>
          )}
        </div>

        {!closed && !submitted && slots.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Envoyer mes réponses
            </Button>
          </div>
        )}

        {submitted && (
          <Card className="p-4 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 text-sm">
            ✅ Vos réponses ont bien été enregistrées. Vous pouvez fermer cette page ou modifier vos choix en revenant sur ce lien avec le même email.
          </Card>
        )}
      </div>
    </div>
  );
}
