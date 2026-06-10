import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users,
  Loader2,
  Mail,
  CircleDot,
  Clock,
  Send,
  MailPlus,
  Link2,
  Copy,
  RefreshCw,
  Check,
  X,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  listSpaceCollaborators,
  addSpaceGuest,
  resendSpaceGuestInvitation,
  notifySpaceGuests,
} from "@/lib/collab.functions";
import {
  getJoinLink,
  toggleJoinLink,
  listJoinRequests,
  reviewJoinRequest,
} from "@/lib/collab-join.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type Collaborator = {
  key: string;
  name: string;
  email: string | null;
  organization: string | null;
  source: "group" | "guest";
  group_names: string[];
  role: string | null;
  invited: boolean;
  status: string | null;
  last_active_at: string | null;
  guest_id: string | null;
};

export function SpaceCollaboratorsTab({ spaceId }: { spaceId: string }) {
  const fn = useServerFn(listSpaceCollaborators);
  const addGuestFn = useServerFn(addSpaceGuest);
  const resendFn = useServerFn(resendSpaceGuestInvitation);
  const notifyFn = useServerFn(notifySpaceGuests);
  const qc = useQueryClient();
  const queryKey = ["space-collaborators", spaceId];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fn({ data: { spaceId } }),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const rows = useMemo<Collaborator[]>(() => (data?.collaborators ?? []) as Collaborator[], [data]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<Collaborator | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleInvite = async (c: Collaborator) => {
    if (!c.email) return toast.error("Pas d'email pour ce collaborateur");
    setBusyKey(c.key);
    try {
      if (c.invited && c.guest_id) {
        const r = await resendFn({ data: { guestId: c.guest_id, appOrigin: baseUrl } });
        if (r.success) toast.success("Invitation renvoyée");
        else toast.error(`Échec${r.reason ? ` · ${r.reason}` : ""}`);
      } else {
        const r = await addGuestFn({
          data: {
            spaceId,
            name: c.name,
            email: c.email,
            role: "viewer",
            sendInvitation: true,
            appOrigin: baseUrl,
          },
        });
        if (r.emailSent) toast.success("Invitation envoyée");
        else if (r.emailReason === "space_not_public")
          toast.warning("Rendez d'abord l'espace public (bouton Partager)");
        else toast.info(`Invité ajouté${r.emailReason ? ` · ${r.emailReason}` : ""}`);
      }
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyKey(null);
    }
  };

  const openCompose = (c: Collaborator) => {
    if (!c.email) return toast.error("Pas d'email pour ce collaborateur");
    setComposeFor(c);
    setSubject("");
    setMessage("");
  };

  const handleSendCustom = async () => {
    if (!composeFor) return;
    if (!subject.trim() || !message.trim()) return toast.error("Sujet et message requis");
    setSending(true);
    try {
      let guestId = composeFor.guest_id;
      if (!guestId) {
        const r = await addGuestFn({
          data: {
            spaceId,
            name: composeFor.name,
            email: composeFor.email!,
            role: "viewer",
            sendInvitation: false,
            appOrigin: baseUrl,
          },
        });
        guestId = r.guest?.id ?? null;
        if (!guestId) throw new Error("Impossible de créer l'invité");
      }
      const r = await notifyFn({
        data: {
          spaceId,
          guestIds: [guestId],
          subjectLine: subject.trim(),
          message: message.trim(),
          appOrigin: baseUrl,
        },
      });
      if (r.sent > 0) toast.success("Email envoyé");
      else toast.error(`Aucun envoi${r.failed ? ` · ${r.failed} échec(s)` : ""}`);
      setComposeFor(null);
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Erreur : {error instanceof Error ? error.message : "inconnue"}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-3 space-y-3">
        <JoinLinkAndRequests spaceId={spaceId} />
        <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p>Aucun collaborateur pour l'instant.</p>
          <p className="text-xs">
            Liez un groupe de contacts à ce projet, ajoutez des invités via « Partager », ou
            partagez le lien d'invitation ci-dessus.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <JoinLinkAndRequests spaceId={spaceId} />

      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Collaborateurs</h3>
        <Badge variant="secondary">{rows.length}</Badge>
        {data?.groupCount ? (
          <span className="text-xs text-muted-foreground">
            · {data.groupCount} groupe{data.groupCount > 1 ? "s" : ""} lié{data.groupCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Membres des groupes liés + invités. L'envoi d'email nécessite que l'espace soit public
        (bouton « Partager »).
      </p>


      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="hidden md:table-cell">Organisation</TableHead>
              <TableHead className="hidden lg:table-cell">Groupe(s)</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const busy = busyKey === r.key;
              return (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs">
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        className="inline-flex items-center gap-1 hover:underline text-muted-foreground"
                      >
                        <Mail className="h-3 w-3" /> {r.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {r.organization ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {r.group_names.length > 0 ? (
                        r.group_names.map((g) => (
                          <Badge key={g} variant="outline" className="text-[10px]">
                            {g}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.invited ? (
                      <Badge
                        variant={r.status === "active" ? "default" : "secondary"}
                        className="text-[10px] gap-1"
                      >
                        <CircleDot className="h-2.5 w-2.5" />
                        {r.status === "active" ? "Invité actif" : r.status ?? "Invité"}
                        {r.role ? ` · ${r.role === "contributor" ? "Contrib." : "Lect."}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Non invité
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.last_active_at ? (
                      <span
                        className="inline-flex items-center gap-1 text-muted-foreground"
                        title={new Date(r.last_active_at).toLocaleString("fr-FR")}
                      >
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(r.last_active_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">Jamais</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={r.invited ? "Renvoyer l'invitation" : "Envoyer une invitation"}
                        disabled={busy || !r.email}
                        onClick={() => handleInvite(r)}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Envoyer un email personnalisé"
                        disabled={!r.email}
                        onClick={() => openCompose(r)}
                      >
                        <MailPlus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!composeFor} onOpenChange={(v) => !v && setComposeFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Envoyer un email à {composeFor?.name}
              <div className="text-xs font-normal text-muted-foreground mt-0.5">
                {composeFor?.email}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Sujet</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex : Point sur le projet"
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Message</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="Votre message…"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Un lien d'accès personnel à l'espace sera ajouté automatiquement.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeFor(null)} disabled={sending}>
              Annuler
            </Button>
            <Button onClick={handleSendCustom} disabled={sending}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
