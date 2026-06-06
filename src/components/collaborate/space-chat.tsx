import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Smartphone, Sparkles, Trash2, Mic, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { listSpaceMessages, postSpaceMessage, deleteSpaceMessage } from "@/lib/collab.functions";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { ChatMentionPopover } from "./chat-mention-popover";
import { ChatSlashMenu, type ChatSlashCommand } from "./chat-slash-menu";
import { AiAssistantModal } from "@/components/ai/ai-assistant-modal";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";

interface Props {
  spaceId: string;
  currentUserId: string;
}

interface Attachment {
  path: string;
  name: string;
  mime: string | null;
  size: number;
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

function renderContent(content: string) {
  // Highlight @[name] mentions
  const parts = content.split(/(@\[[^\]]+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^@\[([^\]]+)\]$/);
    if (m) {
      return (
        <span key={i} className="text-primary font-medium">
          @{m[1]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function AttachmentChip({ a }: { a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.storage
      .from("documents")
      .createSignedUrl(a.path, 3600)
      .then(({ data }) => {
        if (active) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      active = false;
    };
  }, [a.path]);
  const isImg = a.mime?.startsWith("image/");
  if (isImg && url) {
    return (
      <a href={url} target="_blank" rel="noopener" className="block mt-1">
        <img src={url} alt={a.name} className="max-h-40 rounded border" />
      </a>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener"
      className="mt-1 inline-flex items-center gap-1.5 text-xs underline opacity-90"
    >
      <Paperclip className="h-3 w-3" />
      {a.name}
    </a>
  );
}

export function SpaceChat({ spaceId, currentUserId }: Props) {
  const listFn = useServerFn(listSpaceMessages);
  const postFn = useServerFn(postSpaceMessage);
  const delFn = useServerFn(deleteSpaceMessage);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const queryKey = ["collab-messages", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Slash + mention state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");

  // Voice
  const { supported: voiceSupported, listening, start, stop } = useVoiceDictation({
    lang: "fr-FR",
    onFinal: (t) => setDraft((d) => (d ? `${d} ${t}` : t)),
  });

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length]);

  const post = useMutation({
    mutationFn: (vars: { content: string; attachments: Attachment[] }) =>
      postFn({
        data: {
          spaceId,
          content: vars.content,
          metadata: vars.attachments.length ? { attachments: vars.attachments } : undefined,
        },
      }),
    onSuccess: () => {
      setDraft("");
      setAttachments([]);
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

  const handleSubmit = () => {
    const c = draft.trim();
    if (!c && attachments.length === 0) return;
    post.mutate({ content: c || "(pièce jointe)", attachments });
  };

  const updateDraftAndDetect = (v: string) => {
    setDraft(v);
    const caret = textareaRef.current?.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const slashMatch = /(?:^|\s)\/([a-z]*)$/i.exec(before);
    const mentionMatch = /(?:^|\s)@([\p{L}\p{N}\s]{0,30})$/u.exec(before);
    if (slashMatch) {
      setSlashOpen(true);
      setSlashQuery(slashMatch[1]);
      setMentionOpen(false);
    } else if (mentionMatch) {
      setMentionOpen(true);
      setMentionQuery(mentionMatch[1].trim());
      setSlashOpen(false);
    } else {
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const insertMention = (name: string) => {
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@[\p{L}\p{N}\s]{0,30}$/u, "");
    const after = draft.slice(caret);
    const next = `${before}@[${name}] ${after}`;
    setDraft(next);
    setMentionOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSlash = (cmd: ChatSlashCommand) => {
    setSlashOpen(false);
    // Clear the typed /xxx token
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/\/[a-z]*$/i, "");
    setDraft(before + draft.slice(caret));

    if (cmd === "ia") {
      setAiOpen(true);
      return;
    }
    // For task/meeting/poll/doc, navigate to the relevant module. Linking will
    // be done from that module via the existing entity menus, then surfaced in
    // the Liens tab of this space.
    const targets: Record<typeof cmd, string> = {
      tache: "/tasks",
      reunion: "/meetings",
      sondage: "/meetings",
      doc: "/documents",
      ia: "/collaborate",
    };
    toast.info(`Ouvre ${cmd === "sondage" ? "Réunions (sondage)" : cmd}…`, {
      description: "Crée l'entité puis reviens l'attacher via « + Lier ».",
    });
    navigate({ to: targets[cmd] });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploads: Attachment[] = [];
      for (const f of Array.from(files)) {
        const path = `chat/${currentUserId}/${spaceId}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
        const { error } = await supabase.storage.from("documents").upload(path, f, {
          contentType: f.type || undefined,
          upsert: false,
        });
        if (error) {
          toast.error(`Upload ${f.name}: ${error.message}`);
          continue;
        }
        uploads.push({ path, name: f.name, mime: f.type || null, size: f.size });
      }
      setAttachments((a) => [...a, ...uploads]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/20">
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
              const atts = ((m.metadata as { attachments?: Attachment[] } | null)?.attachments ?? []);
              return (
                <div
                  key={m.id}
                  className={cn(
                    "group max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    isMine ? "ml-auto bg-primary text-primary-foreground" : "bg-background border",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs opacity-80 mb-0.5">
                    {isImported && <Smartphone className="h-3 w-3" />}
                    {isAi && <Sparkles className="h-3 w-3" />}
                    <span className="font-medium">{m.sender_name ?? (isMine ? "Vous" : "—")}</span>
                    <span>·</span>
                    <span>
                      {formatDistanceToNow(new Date(m.message_at), { addSuffix: true, locale: fr })}
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
                  <div className="whitespace-pre-wrap break-words">{renderContent(m.content)}</div>
                  {atts.map((a, i) => (
                    <AttachmentChip key={i} a={a} />
                  ))}
                </div>
              );
            })
          )}
        </div>

        <form
          className="border-t bg-background p-3 relative"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <ChatSlashMenu
            open={slashOpen}
            query={slashQuery}
            onPick={handleSlash}
            onClose={() => setSlashOpen(false)}
          />
          <ChatMentionPopover
            open={mentionOpen}
            query={mentionQuery}
            onPick={insertMention}
            onClose={() => setMentionOpen(false)}
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 text-xs bg-muted rounded px-2 py-1"
                >
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((arr) => arr.filter((_, idx) => idx !== i))}
                    className="hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => updateDraftAndDetect(e.target.value)}
              placeholder="Écris un message… ( / pour commandes, @ pour mentionner )"
              rows={2}
              className="resize-none text-sm"
              onKeyDown={(e) => {
                if (slashOpen || mentionOpen) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div className="flex flex-col gap-1">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => onFiles(e.target.files)}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Joindre un fichier"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              {voiceSupported && (
                <Button
                  type="button"
                  size="icon"
                  variant={listening ? "destructive" : "ghost"}
                  className={listening ? "animate-pulse" : ""}
                  title={listening ? "Arrêter la dictée" : "Dictée vocale (fr-FR)"}
                  onClick={() => (listening ? stop() : start())}
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="submit"
                disabled={(!draft.trim() && attachments.length === 0) || post.isPending}
                size="icon"
              >
                {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </form>
      </div>
      <AiAssistantModal open={aiOpen} onOpenChange={setAiOpen} />
    </>
  );
}
