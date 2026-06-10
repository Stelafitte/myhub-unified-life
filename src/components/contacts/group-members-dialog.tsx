import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, Pencil, Check, X, UserPlus, Search } from "lucide-react";
import {
  getGroupMembers,
  removeGroupMember,
  syncSmartGroup,
  updateContactGroup,
  addGroupMembers,
} from "@/lib/contacts.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { relativeTime } from "@/lib/relative-time";

type Member = {
  id: string;
  contact_id: string | null;
  external_email: string | null;
  external_name: string | null;
  added_by: string;
  contact: {
    first_name: string | null;
    last_name: string | null;
    organization: string | null;
    email: string[] | null;
    avatar_url: string | null;
  } | null;
};

type GroupHead = {
  id: string;
  name: string;
  description?: string | null;
  group_type: string;
  last_synced_at: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  email: string[] | null;
};

export function GroupMembersDialog({
  groupId,
  open,
  onOpenChange,
  onChanged,
}: {
  groupId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getGroupMembers);
  const removeFn = useServerFn(removeGroupMember);
  const syncFn = useServerFn(syncSmartGroup);
  const updateFn = useServerFn(updateContactGroup);
  const addFn = useServerFn(addGroupMembers);
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["space-collaborators"] });
    qc.invalidateQueries({ queryKey: ["contact-groups"] });
  };
  const [head, setHead] = useState<GroupHead | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // edit head
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingHead, setSavingHead] = useState(false);

  // add members
  const [addOpen, setAddOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [query, setQuery] = useState("");
  const [externalInput, setExternalInput] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const r = await getFn({ data: { groupId } });
      setHead(r.group as GroupHead);
      setMembers((r.members ?? []) as unknown as Member[]);
      setEditName((r.group as GroupHead).name ?? "");
      setEditDesc(((r.group as GroupHead).description ?? "") as string);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && groupId) {
      load();
      setEditing(false);
      setAddOpen(false);
      setQuery("");
      setExternalInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId]);

  useEffect(() => {
    if (!addOpen || !user) return;
    supabase
      .from("contacts")
      .select("id, first_name, last_name, organization, email")
      .eq("user_id", user.id)
      .order("last_name", { ascending: true, nullsFirst: false })
      .limit(500)
      .then(({ data }) => setContacts((data ?? []) as ContactRow[]));
  }, [addOpen, user]);

  const existingContactIds = new Set(members.map((m) => m.contact_id).filter(Boolean) as string[]);
  const existingExternals = new Set(
    members.map((m) => (m.external_email ?? "").toLowerCase()).filter(Boolean),
  );

  const filteredContacts = contacts.filter((c) => {
    if (existingContactIds.has(c.id)) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
    return (
      name.includes(q) ||
      (c.organization ?? "").toLowerCase().includes(q) ||
      (c.email ?? []).some((e) => e.toLowerCase().includes(q))
    );
  });

  const removeOne = async (memberId: string) => {
    if (!groupId) return;
    try {
      await removeFn({ data: { groupId, memberId } });
      setMembers((p) => p.filter((m) => m.id !== memberId));
      invalidateAll();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const sync = async () => {
    if (!groupId) return;
    setSyncing(true);
    try {
      const r = await syncFn({ data: { groupId } });
      toast.success(`Recalculé : +${r.added} / −${r.removed}`);
      await load();
      invalidateAll();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSyncing(false);
    }
  };

  const saveHead = async () => {
    if (!groupId) return;
    if (!editName.trim()) {
      toast.error("Nom obligatoire");
      return;
    }
    setSavingHead(true);
    try {
      await updateFn({
        data: {
          groupId,
          patch: { name: editName.trim(), description: editDesc.trim() || null },
        },
      });
      toast.success("Groupe mis à jour");
      setEditing(false);
      await load();
      invalidateAll();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSavingHead(false);
    }
  };

  const addContact = async (c: ContactRow) => {
    if (!groupId) return;
    setAdding(true);
    try {
      await addFn({
        data: {
          groupId,
          members: [{ contact_id: c.id, added_by: "manual" }],
        },
      });
      await load();
      invalidateAll();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAdding(false);
    }
  };

  const addExternal = async () => {
    if (!groupId) return;
    const v = externalInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Email invalide");
      return;
    }
    if (existingExternals.has(v)) {
      toast.info("Déjà présent");
      return;
    }
    setAdding(true);
    try {
      await addFn({
        data: {
          groupId,
          members: [{ external_email: v, added_by: "manual" }],
        },
      });
      setExternalInput("");
      await load();
      invalidateAll();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8"
                  autoFocus
                />
                <Button size="icon" variant="ghost" onClick={saveHead} disabled={savingHead}>
                  {savingHead ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditing(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>{head?.name ?? "Membres du groupe"}</span>
                {head && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditing(true)}
                    title="Renommer / éditer"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editing && (
            <div>
              <Textarea
                placeholder="Description (optionnel)"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
              />
            </div>
          )}
          {head?.group_type === "smart" && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-2 text-sm">
              <span className="text-muted-foreground">
                {head.last_synced_at
                  ? `Mis à jour ${relativeTime(head.last_synced_at)}`
                  : "Jamais synchronisé"}
              </span>
              <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
                {syncing && <Loader2 className="mr-2 size-3 animate-spin" />} Recalculer
              </Button>
            </div>
          )}

          {head?.group_type !== "smart" && (
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {members.length} membre{members.length > 1 ? "s" : ""}
              </div>
              <Button size="sm" variant="outline" onClick={() => setAddOpen((v) => !v)}>
                <UserPlus className="mr-2 size-3.5" />
                {addOpen ? "Fermer" : "Ajouter un membre"}
              </Button>
            </div>
          )}

          {addOpen && head?.group_type !== "smart" && (
            <div className="rounded-md border border-border bg-muted/30 p-2 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-8"
                  placeholder="Rechercher un contact"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background">
                {filteredContacts.slice(0, 30).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addContact(c)}
                    disabled={adding}
                    className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                          c.email?.[0] ||
                          "Sans nom"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.organization ?? c.email?.[0] ?? ""}
                      </div>
                    </div>
                    <UserPlus className="size-4 text-primary" />
                  </button>
                ))}
                {filteredContacts.length === 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    Aucun contact disponible
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  className="h-8"
                  placeholder="email externe@example.com"
                  value={externalInput}
                  onChange={(e) => setExternalInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExternal())}
                />
                <Button size="sm" onClick={addExternal} disabled={adding}>
                  Ajouter
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Aucun membre
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {members.map((m) => {
                const name =
                  m.contact
                    ? `${m.contact.first_name ?? ""} ${m.contact.last_name ?? ""}`.trim() ||
                      m.contact.email?.[0] ||
                      "Sans nom"
                    : m.external_name || m.external_email || "Sans nom";
                const sub = m.contact?.organization || m.contact?.email?.[0] || m.external_email;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{name}</div>
                      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
                    </div>
                    <Badge variant="outline" className="text-[10px]">{m.added_by}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeOne(m.id)}
                      aria-label="Retirer"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
