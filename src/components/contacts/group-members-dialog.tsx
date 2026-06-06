import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2 } from "lucide-react";
import {
  getGroupMembers,
  removeGroupMember,
  syncSmartGroup,
} from "@/lib/contacts.functions";
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
  group_type: string;
  last_synced_at: string | null;
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
  const getFn = useServerFn(getGroupMembers);
  const removeFn = useServerFn(removeGroupMember);
  const syncFn = useServerFn(syncSmartGroup);
  const [head, setHead] = useState<GroupHead | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const r = await getFn({ data: { groupId } });
      setHead(r.group as GroupHead);
      setMembers((r.members ?? []) as Member[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && groupId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId]);

  const removeOne = async (memberId: string) => {
    if (!groupId) return;
    try {
      await removeFn({ data: { groupId, memberId } });
      setMembers((p) => p.filter((m) => m.id !== memberId));
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
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{head?.name ?? "Membres du groupe"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
