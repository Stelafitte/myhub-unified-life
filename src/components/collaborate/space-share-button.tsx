import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Share2, Copy, ExternalLink, Loader2, UserPlus, Trash2, Users, Mail, Send, MailPlus, History, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getSpacePublicSettings,
  setSpacePublic,
  listSpaceGuests,
  addSpaceGuest,
  addSpaceGuestsFromGroup,
  updateSpaceGuestRole,
  removeSpaceGuest,
  notifySpaceGuests,
  resendSpaceGuestInvitation,
  listSpaceGuestEmailHistory,
} from "@/lib/collab.functions";
import { listContactGroups, getGroupMembers } from "@/lib/contacts.functions";

export function SpaceShareButton({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const getFn = useServerFn(getSpacePublicSettings);
  const setFn = useServerFn(setSpacePublic);
  const listGuestsFn = useServerFn(listSpaceGuests);
  const addGuestFn = useServerFn(addSpaceGuest);
  const addGroupFn = useServerFn(addSpaceGuestsFromGroup);
  const updateGuestRoleFn = useServerFn(updateSpaceGuestRole);
  const removeGuestFn = useServerFn(removeSpaceGuest);
  const notifyFn = useServerFn(notifySpaceGuests);
  const resendInviteFn = useServerFn(resendSpaceGuestInvitation);
  const historyFn = useServerFn(listSpaceGuestEmailHistory);
  const listGroupsFn = useServerFn(listContactGroups);
  const qc = useQueryClient();
  const key = ["space-public", spaceId];
  const guestsKey = ["space-guests", spaceId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { spaceId } }),
    enabled: open,
  });
  const space = data?.space;

  const guestsQ = useQuery({
    queryKey: guestsKey,
    queryFn: () => listGuestsFn({ data: { spaceId } }),
    enabled: open,
  });
  const guests = guestsQ.data?.guests ?? [];

  const historyKey = ["space-guest-history", spaceId];
  const historyQ = useQuery({
    queryKey: historyKey,
    queryFn: () => historyFn({ data: { spaceId } }),
    enabled: open,
  });
  const history = historyQ.data?.history ?? [];
  const historyByEmail = useMemo(() => {
    const map = new Map<string, typeof history>();
    for (const h of history) {
      const k = (h.recipient_email || "").toLowerCase();
      const arr = map.get(k) ?? [];
      arr.push(h);
      map.set(k, arr);
    }
    return map;
  }, [history]);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  const groupsQ = useQuery({
    queryKey: ["contact-groups"],
    queryFn: () => listGroupsFn(),
    enabled: open,
  });
  const groups = ((groupsQ.data?.groups ?? []) as unknown) as Array<{ id: string; name: string; member_count?: number | null }>;

  const [isPublic, setIsPublic] = useState(false);
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestRole, setGuestRole] = useState<"viewer" | "contributor">("viewer");
  const [sendMail, setSendMail] = useState(true);
  const [addingGuest, setAddingGuest] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [groupRole, setGroupRole] = useState<"viewer" | "contributor">("viewer");
  const [groupSendMail, setGroupSendMail] = useState(true);
  const [addingGroup, setAddingGroup] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Record<string, boolean>>({});

  const getMembersFn = useServerFn(getGroupMembers);
  const membersQ = useQuery({
    queryKey: ["group-members", selectedGroup],
    queryFn: () => getMembersFn({ data: { groupId: selectedGroup } }),
    enabled: open && !!selectedGroup,
  });
  const groupMembers = ((membersQ.data?.members ?? []) as unknown) as Array<{
    id: string;
    external_email: string | null;
    external_name: string | null;
    contact: { first_name?: string | null; last_name?: string | null; email?: string | string[] | null } | null;
  }>;
  const memberDisplay = (m: typeof groupMembers[number]) => {
    const ce = Array.isArray(m.contact?.email) ? m.contact?.email?.[0] : m.contact?.email;
    const email = ce || m.external_email || "";
    const name =
      [m.contact?.first_name, m.contact?.last_name].filter(Boolean).join(" ").trim() ||
      m.external_name ||
      email.split("@")[0] ||
      "(sans nom)";
    return { email, name };
  };

  const [notifySubject, setNotifySubject] = useState("");
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyTargets, setNotifyTargets] = useState<Record<string, boolean>>({});
  const [notifying, setNotifying] = useState(false);

  const handleNotify = async () => {
    if (!notifySubject.trim() || !notifyMessage.trim()) {
      return toast.error("Sujet et message requis");
    }
    const selectedIds = Object.entries(notifyTargets).filter(([, v]) => v).map(([k]) => k);
    setNotifying(true);
    try {
      const res = await notifyFn({
        data: {
          spaceId,
          guestIds: selectedIds.length ? selectedIds : undefined,
          subjectLine: notifySubject.trim(),
          message: notifyMessage.trim(),
          appOrigin: baseUrl,
        },
      });
      if (res.sent === 0) toast.info("Aucun email envoyé (vérifiez les invités avec email)");
      else toast.success(`${res.sent} email${res.sent > 1 ? "s" : ""} envoyé${res.sent > 1 ? "s" : ""}${res.failed ? ` · ${res.failed} échec(s)` : ""}`);
      setNotifySubject("");
      setNotifyMessage("");
      setNotifyTargets({});
      qc.invalidateQueries({ queryKey: historyKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setNotifying(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      setTimeout(() => {
        if (space) {
          setIsPublic(space.is_public);
          setDesc(space.public_description ?? "");
        }
      }, 50);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await setFn({
        data: { spaceId, is_public: isPublic, public_description: desc || null },
      });
      toast.success(isPublic ? "Espace rendu public" : "Espace remis en privé");
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = space?.public_token ? `${baseUrl}/space/${space.public_token}` : "";

  const guestUrl = (accessToken: string) => `${publicUrl}?g=${accessToken}`;

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Lien copié");
  };

  const handleAddGuest = async () => {
    if (!guestName.trim()) return toast.error("Nom requis");
    if (sendMail && !guestEmail.trim()) return toast.error("Email requis pour envoyer une invitation");
    setAddingGuest(true);
    try {
      const res = await addGuestFn({
        data: {
          spaceId,
          name: guestName.trim(),
          email: guestEmail.trim() || null,
          role: guestRole,
          sendInvitation: sendMail && !!guestEmail.trim(),
          appOrigin: baseUrl,
        },
      });
      if (res.emailSent) {
        toast.success("Invité ajouté · email envoyé");
      } else if (sendMail && guestEmail.trim()) {
        toast.success(
          res.emailReason === "space_not_public"
            ? "Invité ajouté (rendez l'espace public pour envoyer l'email)"
            : "Invité ajouté (email non envoyé)",
        );
      } else {
        toast.success("Invité ajouté");
      }
      setGuestName("");
      setGuestEmail("");
      setGuestRole("viewer");
      qc.invalidateQueries({ queryKey: guestsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAddingGuest(false);
    }
  };

  const handleAddGroup = async () => {
    if (!selectedGroup) return toast.error("Sélectionnez un groupe");
    const ids = Object.entries(selectedMemberIds).filter(([, v]) => v).map(([k]) => k);
    setAddingGroup(true);
    try {
      const res = await addGroupFn({
        data: {
          spaceId,
          groupId: selectedGroup,
          role: groupRole,
          sendInvitation: groupSendMail,
          appOrigin: baseUrl,
          memberIds: ids.length ? ids : undefined,
        },
      });
      if (res.added === 0) {
        toast.info("Aucun nouveau contact à ajouter (déjà invités ou sans email)");
      } else {
        toast.success(
          `${res.added} invité${res.added > 1 ? "s" : ""} ajouté${res.added > 1 ? "s" : ""}` +
            (groupSendMail ? ` · ${res.invited} email${res.invited > 1 ? "s" : ""} envoyé${res.invited > 1 ? "s" : ""}` : ""),
        );
      }
      setSelectedGroup("");
      setSelectedMemberIds({});
      qc.invalidateQueries({ queryKey: guestsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAddingGroup(false);
    }
  };

  const handleRoleChange = async (id: string, role: "viewer" | "contributor") => {
    try {
      await updateGuestRoleFn({ data: { id, role } });
      qc.invalidateQueries({ queryKey: guestsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const [resendingId, setResendingId] = useState<string | null>(null);
  const handleResendInvite = async (id: string, email: string | null) => {
    if (!email) return toast.error("Cet invité n'a pas d'email");
    setResendingId(id);
    try {
      const res = await resendInviteFn({ data: { guestId: id, appOrigin: baseUrl } });
      if (res.success) toast.success("Invitation renvoyée");
      else toast.error(`Échec de l'envoi${res.reason ? ` · ${res.reason}` : ""}`);
      qc.invalidateQueries({ queryKey: historyKey });
      setExpandedHistory((s) => ({ ...s, [id]: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setResendingId(null);
    }
  };

  const handleRemoveGuest = async (id: string) => {
    if (!confirm("Retirer cet invité ?")) return;
    try {
      await removeGuestFn({ data: { id } });
      toast.success("Invité retiré");
      qc.invalidateQueries({ queryKey: guestsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Partager">
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Partager cet espace</DialogTitle>
        </DialogHeader>
        {isLoading || !space ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="pub-switch" className="cursor-pointer">
                  Rendre public
                </Label>
                <Switch id="pub-switch" checked={isPublic} onCheckedChange={setIsPublic} />
              </div>
              <div>
                <Label className="text-xs">Description publique (optionnelle)</Label>
                <Textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  placeholder="Présentation affichée aux visiteurs externes"
                />
              </div>
              {space.is_public && (
                <div>
                  <Label className="text-xs">Lien public</Label>
                  <div className="flex gap-1">
                    <Input value={publicUrl} readOnly className="text-xs" />
                    <Button size="icon" variant="outline" onClick={() => copy(publicUrl)} title="Copier">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="outline" asChild title="Ouvrir">
                      <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {space.is_public && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-semibold">Invités avec accès personnel</Label>
                  <Badge variant="secondary">{guests.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Les <strong>contributeurs</strong> voient aussi les sondages clôturés. Les <strong>lecteurs</strong> n'ont accès qu'aux sondages ouverts.
                </p>

                {/* Add individual */}
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground">Ajouter un invité</div>
                  <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-end">
                    <Input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Nom"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="Email"
                      type="email"
                      className="h-8 text-sm"
                    />
                    <Select value={guestRole} onValueChange={(v) => setGuestRole(v as "viewer" | "contributor")}>
                      <SelectTrigger className="h-8 text-xs w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Lecteur</SelectItem>
                        <SelectItem value="contributor">Contributeur</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleAddGuest} disabled={addingGuest}>
                      {addingGuest ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={sendMail} onCheckedChange={(v) => setSendMail(!!v)} />
                    <Mail className="h-3 w-3" />
                    Envoyer un email d'invitation
                  </label>
                </div>

                {/* Add from group */}
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground">Inviter un groupe de contacts</div>
                  <div className="grid sm:grid-cols-[1fr_auto_auto] gap-1.5 items-end">
                    <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder={groups.length ? "Choisir un groupe…" : "Aucun groupe"} />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name} {g.member_count ? `(${g.member_count})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={groupRole} onValueChange={(v) => setGroupRole(v as "viewer" | "contributor")}>
                      <SelectTrigger className="h-8 text-xs w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Lecteur</SelectItem>
                        <SelectItem value="contributor">Contributeur</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleAddGroup} disabled={addingGroup || !selectedGroup}>
                      {addingGroup ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={groupSendMail} onCheckedChange={(v) => setGroupSendMail(!!v)} />
                    <Mail className="h-3 w-3" />
                    Envoyer un email d'invitation à chaque contact
                  </label>
                  {selectedGroup && (
                    <div className="space-y-1 mt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {Object.values(selectedMemberIds).filter(Boolean).length === 0
                            ? "Tous les membres seront invités"
                            : `${Object.values(selectedMemberIds).filter(Boolean).length} sélectionné(s)`}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="underline hover:text-foreground"
                            onClick={() =>
                              setSelectedMemberIds(
                                Object.fromEntries(groupMembers.map((m) => [m.id, true])),
                              )
                            }
                          >
                            Tout cocher
                          </button>
                          <button
                            type="button"
                            className="underline hover:text-foreground"
                            onClick={() => setSelectedMemberIds({})}
                          >
                            Tout décocher
                          </button>
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                        {membersQ.isLoading ? (
                          <div className="text-xs text-muted-foreground">Chargement…</div>
                        ) : groupMembers.length === 0 ? (
                          <div className="text-xs text-muted-foreground">Aucun membre</div>
                        ) : (
                          groupMembers.map((m) => {
                            const { name, email } = memberDisplay(m);
                            return (
                              <label key={m.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                  checked={!!selectedMemberIds[m.id]}
                                  onCheckedChange={(v) =>
                                    setSelectedMemberIds((s) => ({ ...s, [m.id]: !!v }))
                                  }
                                />
                                <span className="truncate">
                                  {name}
                                  {email && (
                                    <span className="text-muted-foreground"> · {email}</span>
                                  )}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {guests.length > 0 && (
                  <ul className="divide-y border rounded-md mt-2">
                    {guests.map((g) => (
                      <li key={g.id} className="py-2 px-2 flex items-center gap-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{g.name}</div>
                          {g.email && <div className="text-xs text-muted-foreground truncate">{g.email}</div>}
                        </div>
                        <Select
                          value={g.role}
                          onValueChange={(v) => handleRoleChange(g.id, v as "viewer" | "contributor")}
                        >
                          <SelectTrigger className="h-7 text-xs w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Lecteur</SelectItem>
                            <SelectItem value="contributor">Contributeur</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => copy(guestUrl(g.access_token))}
                          title="Copier le lien personnel"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleResendInvite(g.id, g.email)}
                          disabled={!g.email || resendingId === g.id || !space.is_public}
                          title={
                            !g.email
                              ? "Pas d'email"
                              : !space.is_public
                                ? "Rendez l'espace public d'abord"
                                : "Envoyer / renvoyer l'invitation par email"
                          }
                        >
                          {resendingId === g.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MailPlus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600"
                          onClick={() => handleRemoveGuest(g.id)}
                          title="Retirer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {guests.length > 0 && (
                  <div className="space-y-2 rounded-md border p-3 mt-3">
                    <div className="flex items-center gap-2">
                      <Send className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label className="text-sm font-semibold">Notifier les invités</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Envoie un email d'information (nouveau contenu, nouvelle info, chat modifié…) avec leur lien personnel d'accès.
                    </p>
                    <Input
                      value={notifySubject}
                      onChange={(e) => setNotifySubject(e.target.value)}
                      placeholder="Sujet (ex: Nouveau document partagé)"
                      className="h-8 text-sm"
                    />
                    <Textarea
                      value={notifyMessage}
                      onChange={(e) => setNotifyMessage(e.target.value)}
                      rows={3}
                      placeholder="Votre message…"
                    />
                    <div className="space-y-1 max-h-32 overflow-y-auto border rounded p-2">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={Object.values(notifyTargets).filter(Boolean).length === 0}
                          onCheckedChange={() => setNotifyTargets({})}
                        />
                        <span className="text-muted-foreground">Tous les invités avec email</span>
                      </label>
                      {guests.filter((g) => !!g.email).map((g) => (
                        <label key={g.id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={!!notifyTargets[g.id]}
                            onCheckedChange={(v) =>
                              setNotifyTargets((s) => ({ ...s, [g.id]: !!v }))
                            }
                          />
                          <span className="truncate">{g.name} <span className="text-muted-foreground">· {g.email}</span></span>
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleNotify} disabled={notifying}>
                        {notifying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Mail className="h-3.5 w-3.5 mr-1" />}
                        Envoyer
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button>
          <Button onClick={save} disabled={saving || isLoading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
