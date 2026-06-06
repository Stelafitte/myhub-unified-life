import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listWaConnections,
  listWaMessages,
  sendWaMessage,
} from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  component: WhatsAppPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Erreur: {error.message}</div>
  ),
});

function WhatsAppPage() {
  const qc = useQueryClient();
  const listConnFn = useServerFn(listWaConnections);
  const listMsgFn = useServerFn(listWaMessages);
  const sendFn = useServerFn(sendWaMessage);

  const { data: connections = [] } = useQuery({
    queryKey: ["wa-connections"],
    queryFn: () => listConnFn(),
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => connections.find((c) => c.id === activeId) ?? connections[0] ?? null,
    [connections, activeId],
  );

  const { data: messages = [], isFetching } = useQuery({
    queryKey: ["wa-messages", active?.id ?? null],
    queryFn: () => (active ? listMsgFn({ data: { connection_id: active.id, limit: 100 } }) : []),
    enabled: !!active,
    refetchInterval: 15_000,
  });

  // Group by peer number
  const conversations = useMemo(() => {
    const map = new Map<string, { peer: string; name: string | null; last: string; count: number }>();
    for (const m of messages) {
      const peer = m.from_number ?? "?";
      const e = map.get(peer);
      if (!e) {
        map.set(peer, { peer, name: m.from_name ?? null, last: m.timestamp, count: 1 });
      } else {
        e.count += 1;
        if (m.timestamp > e.last) e.last = m.timestamp;
        if (!e.name && m.from_name) e.name = m.from_name;
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [messages]);

  const [peer, setPeer] = useState<string | null>(null);
  const peerMessages = useMemo(
    () => (peer ? messages.filter((m) => m.from_number === peer) : []).slice().reverse(),
    [messages, peer],
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!active || !peer || !draft.trim()) return;
    setSending(true);
    try {
      await sendFn({ data: { connection_id: active.id, to: peer, body: draft.trim() } });
      setDraft("");
      qc.invalidateQueries({ queryKey: ["wa-messages", active.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Envoi échoué");
    } finally {
      setSending(false);
    }
  };

  if (connections.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
            Aucun numéro WhatsApp Business connecté.
            <div className="mt-2">
              Ajoute une connexion dans <span className="font-medium">Paramètres → WhatsApp</span>.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-600" /> WhatsApp
        </h1>
        <div className="flex items-center gap-2">
          {connections.length > 1 && (
            <select
              className="text-sm border rounded px-2 py-1 bg-background"
              value={active?.id ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name || c.phone_number}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => active && qc.invalidateQueries({ queryKey: ["wa-messages", active.id] })}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        <Card className="md:h-[calc(100vh-180px)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conversations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px] md:h-[calc(100vh-260px)]">
              {conversations.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">Aucune conversation</div>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.peer}
                    onClick={() => setPeer(c.peer)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/50 border-b text-sm ${
                      peer === c.peer ? "bg-muted" : ""
                    }`}
                  >
                    <div className="font-medium truncate">{c.name || c.peer}</div>
                    <div className="text-xs text-muted-foreground">+{c.peer}</div>
                  </button>
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="md:h-[calc(100vh-180px)] flex flex-col">
          <CardHeader className="pb-2 border-b">
            <CardTitle className="text-sm">
              {peer ? (
                <span>
                  +{peer}
                  {(() => {
                    const c = conversations.find((x) => x.peer === peer);
                    return c?.name ? <span className="ml-2 text-muted-foreground">{c.name}</span> : null;
                  })()}
                </span>
              ) : (
                <span className="text-muted-foreground">Sélectionne une conversation</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 flex flex-col">
            <ScrollArea className="flex-1 h-[300px] md:h-auto p-3">
              {peer ? (
                peerMessages.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-6 text-center">Aucun message</div>
                ) : (
                  <div className="space-y-2">
                    {peerMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          m.is_from_me ? "ml-auto bg-green-100 dark:bg-green-900/40" : "bg-muted"
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.content || <em className="opacity-60">[{m.type}]</em>}</div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{new Date(m.timestamp).toLocaleString()}</span>
                          {m.ai_category && <Badge variant="outline" className="h-4 px-1 text-[10px]">{m.ai_category}</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </ScrollArea>

            {peer && (
              <div className="border-t p-2 flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Écris un message…"
                  rows={2}
                  className="resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button onClick={handleSend} disabled={sending || !draft.trim()} className="self-end">
                  <Send className="h-4 w-4 mr-1" />
                  {sending ? "…" : "Envoyer"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {peer && (
        <div className="md:hidden">
          <Input
            placeholder="Numéro destinataire (E.164)"
            value={peer}
            onChange={(e) => setPeer(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
      )}
    </div>
  );
}
