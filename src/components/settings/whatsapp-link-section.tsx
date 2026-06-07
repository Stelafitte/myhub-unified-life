import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Unlink, MessageCircle, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listWaLinkCandidates,
  linkSpaceToWa,
  unlinkSpaceFromWa,
  proposeWaAutoMatches,
} from "@/lib/wa-link.functions";

export function WhatsAppLinkSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWaLinkCandidates);
  const linkFn = useServerFn(linkSpaceToWa);
  const unlinkFn = useServerFn(unlinkSpaceFromWa);
  const proposeFn = useServerFn(proposeWaAutoMatches);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["wa-link-candidates"],
    queryFn: () => listFn(),
  });

  // selected target per space row
  const [selection, setSelection] = useState<
    Record<string, { kind: "group" | "peer"; connection_id: string; key: string } | null>
  >({});
  const [busy, setBusy] = useState<string | null>(null);

  const spaces = data?.spaces ?? [];
  const groups = data?.groups ?? [];
  const peers = data?.peers ?? [];
  const connections = data?.connections ?? [];

  // Map for quick label lookup of an already linked target
  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.wa_group_id, g.name);
    return m;
  }, [groups]);

  const handleLink = async (space_id: string) => {
    const sel = selection[space_id];
    if (!sel) return;
    setBusy(space_id);
    try {
      if (sel.kind === "group") {
        await linkFn({
          data: {
            kind: "group",
            space_id,
            connection_id: sel.connection_id,
            wa_group_id: sel.key,
          },
        });
      } else {
        await linkFn({
          data: {
            kind: "peer",
            space_id,
            connection_id: sel.connection_id,
            peer_number: sel.key,
          },
        });
      }
      toast.success("Fil associé");
      setSelection((s) => ({ ...s, [space_id]: null }));
      qc.invalidateQueries({ queryKey: ["wa-link-candidates"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'association");
    } finally {
      setBusy(null);
    }
  };

  const handleUnlink = async (space_id: string) => {
    setBusy(space_id);
    try {
      await unlinkFn({ data: { space_id } });
      toast.success("Association supprimée");
      qc.invalidateQueries({ queryKey: ["wa-link-candidates"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(null);
    }
  };

  const handleAutoMatch = async () => {
    try {
      const proposals = await proposeFn();
      if (proposals.length === 0) {
        toast.info("Aucune correspondance automatique trouvée");
        return;
      }
      let applied = 0;
      for (const p of proposals) {
        try {
          await linkFn({
            data: {
              kind: "group",
              space_id: p.space_id,
              connection_id: p.connection_id,
              wa_group_id: p.wa_group_id,
            },
          });
          applied += 1;
        } catch {
          /* ignore individual failures */
        }
      }
      toast.success(`${applied} association(s) appliquée(s)`);
      qc.invalidateQueries({ queryKey: ["wa-link-candidates"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  };

  if (connections.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="h-4 w-4 text-green-600" />
          Associer les fils du Hub aux conversations WhatsApp Business
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAutoMatch}>
            <Sparkles className="h-4 w-4 mr-1" /> Auto-associer par nom
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {spaces.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Aucun fil WhatsApp importé dans le Hub.
          </div>
        ) : (
          <div className="rounded-md border divide-y">
            {spaces.map((sp) => {
              const linkedGroup = sp.whatsapp_group_id
                ? groupLabel.get(sp.whatsapp_group_id) ?? sp.whatsapp_group_id
                : null;
              const linkedPeer = sp.whatsapp_phone_number;
              const isLinked = !!(linkedGroup || linkedPeer);
              const sel = selection[sp.id];

              return (
                <div
                  key={sp.id}
                  className="flex flex-col md:flex-row md:items-center gap-2 p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      {sp.name}
                      {sp.wa_group_name && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1">
                          import: {sp.wa_group_name}
                        </Badge>
                      )}
                    </div>
                    {isLinked && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Lié à{" "}
                        <span className="font-medium">
                          {linkedGroup ? `groupe « ${linkedGroup} »` : `+${linkedPeer}`}
                        </span>
                      </div>
                    )}
                  </div>

                  {isLinked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnlink(sp.id)}
                      disabled={busy === sp.id}
                    >
                      <Unlink className="h-3.5 w-3.5 mr-1" /> Dissocier
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <Select
                        value={sel ? `${sel.kind}:${sel.connection_id}:${sel.key}` : ""}
                        onValueChange={(v) => {
                          const [kind, connection_id, ...rest] = v.split(":");
                          setSelection((s) => ({
                            ...s,
                            [sp.id]: {
                              kind: kind as "group" | "peer",
                              connection_id,
                              key: rest.join(":"),
                            },
                          }));
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs min-w-[260px]">
                          <SelectValue placeholder="Choisir un fil WhatsApp Business…" />
                        </SelectTrigger>
                        <SelectContent>
                          {groups.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Groupes
                              </div>
                              {groups
                                .filter((g) => !g.space_id)
                                .map((g) => (
                                  <SelectItem
                                    key={`g-${g.id}`}
                                    value={`group:${g.connection_id}:${g.wa_group_id}`}
                                  >
                                    👥 {g.name}
                                    {g.participant_count ? ` (${g.participant_count})` : ""}
                                  </SelectItem>
                                ))}
                            </>
                          )}
                          {peers.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Conversations 1-à-1
                              </div>
                              {peers
                                .filter((p) => !p.space_id)
                                .map((p) => (
                                  <SelectItem
                                    key={`p-${p.connection_id}-${p.peer}`}
                                    value={`peer:${p.connection_id}:${p.peer}`}
                                  >
                                    💬 {p.name || `+${p.peer}`} ({p.count})
                                  </SelectItem>
                                ))}
                            </>
                          )}
                          {groups.length === 0 && peers.length === 0 && (
                            <div className="px-2 py-2 text-xs text-muted-foreground">
                              Aucun fil actif détecté
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => handleLink(sp.id)}
                        disabled={!sel || busy === sp.id}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1" /> Associer
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground pt-1">
          Astuce : l'API WhatsApp Business Cloud ne diffuse que les conversations 1-à-1
          et les groupes pour lesquels ton numéro est ajouté. Les groupes apparaissent
          au fil des messages entrants.
        </div>
      </CardContent>
    </Card>
  );
}
