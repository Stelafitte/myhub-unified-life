import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Sparkles,
  Bot,
  Copy,
  Trash2,
  RefreshCw,
  Send,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listContactGroups,
  deleteContactGroup,
  duplicateContactGroup,
  suggestGroupsFromContext,
  syncSmartGroup,
} from "@/lib/contacts.functions";
import { confirmDialog } from "@/lib/confirm-dialog";
import { relativeTime } from "@/lib/relative-time";
import { GroupFormDialog } from "./group-form-dialog";
import { GroupMembersDialog } from "./group-members-dialog";

type Group = {
  id: string;
  name: string;
  description: string | null;
  group_type: "manual" | "smart" | "space" | "whatsapp";
  source: "user" | "ai" | "whatsapp" | "space";
  color: string | null;
  icon: string | null;
  space_id: string | null;
  is_smart: boolean;
  member_count: number;
  last_synced_at: string | null;
  updated_at: string;
  space: { name: string; color: string | null } | null;
};

type Suggestion = {
  title: string;
  reason: string;
  group_type: "manual" | "smart" | "space" | "whatsapp";
  space_id?: string;
};

export function ContactGroupsPanel() {
  const listFn = useServerFn(listContactGroups);
  const deleteFn = useServerFn(deleteContactGroup);
  const duplicateFn = useServerFn(duplicateContactGroup);
  const syncFn = useServerFn(syncSmartGroup);
  const suggestFn = useServerFn(suggestGroupsFromContext);

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSug, setLoadingSug] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listFn();
      setGroups((r.groups ?? []) as Group[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    load();
  }, [load]);

  const loadSuggestions = async () => {
    setLoadingSug(true);
    try {
      const r = await suggestFn();
      setSuggestions((r.suggestions ?? []) as Suggestion[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoadingSug(false);
    }
  };

  const remove = async (g: Group) => {
    if (!(await confirmDialog(`Supprimer le groupe « ${g.name} » ?`))) return;
    await deleteFn({ data: { groupId: g.id } });
    setGroups((p) => p.filter((x) => x.id !== g.id));
    toast.success("Groupe supprimé");
  };

  const duplicate = async (g: Group) => {
    await duplicateFn({ data: { groupId: g.id } });
    toast.success("Groupe dupliqué");
    load();
  };

  const sync = async (g: Group) => {
    try {
      const r = await syncFn({ data: { groupId: g.id } });
      toast.success(`Recalculé : +${r.added} / −${r.removed}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const sendSolicitation = (g: Group) => {
    toast.info(`Sollicitation prévue pour « ${g.name} » (à venir).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="size-5" /> Groupes de contacts
          </h2>
          <p className="text-sm text-muted-foreground">
            Organise tes contacts par projet, comité ou règles dynamiques.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadSuggestions} disabled={loadingSug}>
            {loadingSug ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            Suggérer
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 size-4" /> Nouveau groupe
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Suggestions IA
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSuggestions([])}>
              Masquer
            </Button>
          </div>
          <div className="space-y-1">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.reason}</div>
                </div>
                <Badge variant="secondary">{s.group_type}</Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Crée-les manuellement via « Nouveau groupe » — aucune création automatique.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Users className="mx-auto mb-2 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Aucun groupe pour l'instant. Crée ton premier groupe pour regrouper tes contacts par projet.
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left flex-1"
                  onClick={() => setMembersOpen(g.id)}
                >
                  <div className="font-medium truncate">{g.name}</div>
                  {g.description && (
                    <div className="text-xs text-muted-foreground truncate">{g.description}</div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {g.member_count} membre{g.member_count > 1 ? "s" : ""}
                    </Badge>
                    {g.space && (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={
                          g.space.color
                            ? { borderColor: g.space.color, color: g.space.color }
                            : undefined
                        }
                      >
                        {g.space.name}
                      </Badge>
                    )}
                    {g.source === "ai" && (
                      <Badge className="text-[10px] gap-1">
                        <Sparkles className="size-3" /> IA
                      </Badge>
                    )}
                    {g.is_smart && (
                      <Badge className="text-[10px] gap-1 bg-violet-600 hover:bg-violet-600">
                        <Bot className="size-3" /> Smart
                      </Badge>
                    )}
                  </div>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                <div className="text-[11px] text-muted-foreground">
                  MAJ {relativeTime(g.updated_at)}
                </div>
                <div className="flex gap-0.5">
                  {g.is_smart && (
                    <Button size="icon" variant="ghost" onClick={() => sync(g)} title="Recalculer">
                      <RefreshCw className="size-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => sendSolicitation(g)}
                    title="Envoyer sollicitation"
                  >
                    <Send className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => duplicate(g)}
                    title="Dupliquer"
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(g)}
                    title="Supprimer"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <GroupFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={load}
      />
      <GroupMembersDialog
        groupId={membersOpen}
        open={!!membersOpen}
        onOpenChange={(v) => !v && setMembersOpen(null)}
        onChanged={load}
      />
    </div>
  );
}
