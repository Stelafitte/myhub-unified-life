import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  listContactGroups,
  getGroupMembers,
} from "@/lib/contacts.functions";
import { GroupMembersDialog } from "@/components/contacts/group-members-dialog";

type Group = {
  id: string;
  name: string;
  color: string | null;
  space_id: string | null;
  member_count: number;
};

type Member = {
  id: string;
  external_name: string | null;
  external_email: string | null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    email: string[] | null;
    organization: string | null;
  } | null;
};

function memberLabel(m: Member): string {
  if (m.contact) {
    const name = `${m.contact.first_name ?? ""} ${m.contact.last_name ?? ""}`.trim();
    return name || m.contact.email?.[0] || m.contact.organization || "Sans nom";
  }
  return m.external_name || m.external_email || "Sans nom";
}

function MemberPreview({ groupId }: { groupId: string }) {
  const getFn = useServerFn(getGroupMembers);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    getFn({ data: { groupId } })
      .then((r) => {
        if (!cancel) setMembers((r.members ?? []) as unknown as Member[]);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [groupId, getFn]);

  if (loading || !members) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Chargement…
      </div>
    );
  }
  if (members.length === 0) {
    return <div className="text-xs text-muted-foreground py-1">Aucun membre</div>;
  }
  const shown = members.slice(0, 12);
  return (
    <div className="space-y-1">
      {shown.map((m) => (
        <div key={m.id} className="text-xs truncate">
          • {memberLabel(m)}
        </div>
      ))}
      {members.length > shown.length && (
        <div className="text-[11px] text-muted-foreground pt-1">
          +{members.length - shown.length} autre(s)…
        </div>
      )}
    </div>
  );
}

export function SpaceContactGroupsBar({ spaceId }: { spaceId: string }) {
  const listFn = useServerFn(listContactGroups);
  const [groups, setGroups] = useState<Group[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listFn();
      const all = (r.groups ?? []) as unknown as Group[];
      setGroups(all.filter((g) => g.space_id === spaceId));
    } catch {
      // ignore
    }
  }, [listFn, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (groups.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-2 sm:px-3 mt-2">
        {groups.map((g) => (
          <HoverCard key={g.id} openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setOpenId(g.id)}
                title="Ouvrir le sous-groupe contacts"
              >
                <Users className="h-3 w-3" />
                <span className="max-w-[160px] truncate">{g.name}</span>
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-1">
                  {g.member_count}
                </Badge>
              </Button>
            </HoverCardTrigger>
            <HoverCardContent className="w-64" align="start">
              <div className="text-xs font-semibold mb-1.5 truncate">{g.name}</div>
              <MemberPreview groupId={g.id} />
              <div className="text-[10px] text-muted-foreground mt-2 border-t pt-1.5">
                Cliquer pour éditer
              </div>
            </HoverCardContent>
          </HoverCard>
        ))}
      </div>
      <GroupMembersDialog
        groupId={openId}
        open={!!openId}
        onOpenChange={(v) => !v && setOpenId(null)}
        onChanged={load}
      />
    </>
  );
}
