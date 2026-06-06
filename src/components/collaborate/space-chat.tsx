import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { listSpaceMessages, postSpaceMessage, deleteSpaceMessage } from "@/lib/collab.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  spaceId: string;
  currentUserId: string;
}

interface Msg {
  id: string;
  content: string;
  type: string;
  sender_name: string | null;
  message_at: string;
  metadata: Record<string, unknown> | null;
  user_id: string;
}

export function SpaceChat({ spaceId, currentUserId }: Props) {
  const listFn = useServerFn(listSpaceMessages);
  const postFn = useServerFn(postSpaceMessage);
  const delFn = useServerFn(deleteSpaceMessage);
  const qc = useQueryClient();
  const queryKey = ["collab-messages", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`collab-chat-${spaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "collab_messages", filter: `space_id=eq.${spaceId}` },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length]);

  const post = useMutation({
    mutationFn: (content: string) => postFn({ data: { spaceId, content } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (messageId: string) => delFn({ data: { messageId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const messages = (data?.messages ?? []) as Msg[];

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/20"
      >
        {isLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            Aucun message. Lance la conversation 👇
          </div>
        ) : (
          messages.map((m) => {
            const isImported = (m.metadata as { is_imported?: boolean } | null)?.is_imported === true;
            const isAi = m.type === "ai";
            const isMine = m.user_id === currentUserId && !isImported;
            return (
              <div
                key={m.id}
                className={cn(
                  "group max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  isMine
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-background border",
                )}
              >
                <div className="flex items-center gap-1.5 text-xs opacity-80 mb-0.5">
                  {isImported && <Smartphone className="h-3 w-3" />}
                  {isAi && <Sparkles className="h-3 w-3" />}
                  <span className="font-medium">
                    {m.sender_name ?? (isMine ? "Vous" : "—")}
                  </span>
                  <span>·</span>
                  <span>
                    {formatDistanceToNow(new Date(m.message_at), {
                      addSuffix: true,
                      locale: fr,
                    })}
                  </span>
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => del.mutate(m.id)}
                      className="opacity-0 group-hover:opacity-100 ml-1 hover:text-destructive"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            );
          })
        )}
      </div>

      <form
        className="border-t bg-background p-3 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          post.mutate(draft.trim());
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Écris un message… (Entrée pour envoyer, Maj+Entrée pour saut de ligne)"
          rows={2}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim()) post.mutate(draft.trim());
            }
          }}
        />
        <Button type="submit" disabled={!draft.trim() || post.isPending} size="icon">
          {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
