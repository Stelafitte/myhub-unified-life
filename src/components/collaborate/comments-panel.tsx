import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listDocumentComments,
  createDocumentComment,
  setDocumentCommentResolved,
  deleteDocumentComment,
  type DocCommentRow,
} from "@/lib/collab-collab.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Send,
  Check,
  Undo2,
  Trash2,
  Reply,
  Loader2,
  CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  documentId: string;
  /** Optional selected text the user wants to comment on (from editor). */
  pendingAnchor?: {
    text: string;
    from: number;
    to: number;
  } | null;
  onConsumeAnchor?: () => void;
  refreshKey?: number;
}

export function CommentsPanel({
  documentId,
  pendingAnchor,
  onConsumeAnchor,
  refreshKey,
}: Props) {
  const listFn = useServerFn(listDocumentComments);
  const createFn = useServerFn(createDocumentComment);
  const resolveFn = useServerFn(setDocumentCommentResolved);
  const deleteFn = useServerFn(deleteDocumentComment);

  const [comments, setComments] = useState<DocCommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listFn({ data: { documentId, includeResolved } });
      setComments(res.comments);
    } catch (e) {
      toast.error("Chargement des commentaires échoué", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [documentId, includeResolved, listFn]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleCreate = async () => {
    const body = newBody.trim();
    if (!body) return;
    try {
      setSubmitting(true);
      await createFn({
        data: {
          documentId,
          body,
          anchorText: pendingAnchor?.text.slice(0, 500) ?? null,
          anchorFrom: pendingAnchor?.from ?? null,
          anchorTo: pendingAnchor?.to ?? null,
        },
      });
      setNewBody("");
      onConsumeAnchor?.();
      await load();
    } catch (e) {
      toast.error("Création du commentaire échouée", {
        description: (e as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (parentId: string) => {
    const body = replyBody.trim();
    if (!body) return;
    try {
      setSubmitting(true);
      await createFn({
        data: { documentId, body, parentId },
      });
      setReplyBody("");
      setReplyTo(null);
      await load();
    } catch (e) {
      toast.error("Réponse échouée", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (id: string, resolved: boolean) => {
    try {
      await resolveFn({ data: { commentId: id, resolved } });
      await load();
    } catch (e) {
      toast.error("Action impossible", { description: (e as Error).message });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce commentaire ?")) return;
    try {
      await deleteFn({ data: { commentId: id } });
      await load();
    } catch (e) {
      toast.error("Suppression impossible", {
        description: (e as Error).message,
      });
    }
  };

  // Build a tree: top-level first, replies grouped by parent
  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, DocCommentRow[]>();
  for (const c of comments) {
    if (c.parent_id) {
      const arr = repliesByParent.get(c.parent_id) ?? [];
      arr.push(c);
      repliesByParent.set(c.parent_id, arr);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="h-4 w-4" />
          Commentaires
          <span className="text-xs text-muted-foreground">
            ({topLevel.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-resolved"
            checked={includeResolved}
            onCheckedChange={setIncludeResolved}
          />
          <Label htmlFor="show-resolved" className="text-xs">
            Résolus
          </Label>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {loading && comments.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Chargement…
            </div>
          ) : topLevel.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Aucun commentaire pour l'instant.
              <br />
              Sélectionne du texte puis ajoute un commentaire.
            </div>
          ) : (
            topLevel.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                replies={repliesByParent.get(c.id) ?? []}
                onResolve={(r) => handleResolve(c.id, r)}
                onDelete={() => handleDelete(c.id)}
                onStartReply={() => {
                  setReplyTo(c.id);
                  setReplyBody("");
                }}
                replying={replyTo === c.id}
                replyBody={replyBody}
                onReplyBodyChange={setReplyBody}
                onCancelReply={() => setReplyTo(null)}
                onSubmitReply={() => handleReply(c.id)}
                onDeleteReply={(rid) => handleDelete(rid)}
                submitting={submitting}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3 space-y-2">
        {pendingAnchor && (
          <div className="text-xs bg-accent/40 border border-accent rounded px-2 py-1 flex items-center justify-between gap-2">
            <span className="truncate italic">
              « {pendingAnchor.text.slice(0, 80)}
              {pendingAnchor.text.length > 80 ? "…" : ""} »
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => onConsumeAnchor?.()}
            >
              ✕
            </Button>
          </div>
        )}
        <Textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={
            pendingAnchor
              ? "Ajouter un commentaire sur la sélection…"
              : "Ajouter un commentaire général…"
          }
          rows={3}
          className="resize-none text-sm"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={submitting || !newBody.trim()}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1" />
            )}
            Publier
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  replies,
  onResolve,
  onDelete,
  onStartReply,
  replying,
  replyBody,
  onReplyBodyChange,
  onCancelReply,
  onSubmitReply,
  onDeleteReply,
  submitting,
}: {
  comment: DocCommentRow;
  replies: DocCommentRow[];
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onStartReply: () => void;
  replying: boolean;
  replyBody: string;
  onReplyBodyChange: (v: string) => void;
  onCancelReply: () => void;
  onSubmitReply: () => void;
  onDeleteReply: (id: string) => void;
  submitting: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-2 ${
        comment.resolved ? "bg-muted/40 opacity-70" : "bg-card"
      }`}
    >
      {comment.anchor_text && (
        <div className="text-xs italic text-muted-foreground border-l-2 border-primary/50 pl-2 mb-1 truncate">
          « {comment.anchor_text} »
        </div>
      )}
      <div className="text-sm whitespace-pre-wrap break-words">
        {comment.body}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
        <span>
          {formatDistanceToNow(new Date(comment.created_at), {
            addSuffix: true,
            locale: fr,
          })}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={onStartReply}
            title="Répondre"
          >
            <Reply className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => onResolve(!comment.resolved)}
            title={comment.resolved ? "Rouvrir" : "Marquer résolu"}
          >
            {comment.resolved ? (
              <Undo2 className="h-3 w-3" />
            ) : (
              <Check className="h-3 w-3 text-green-600" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-destructive hover:text-destructive"
            onClick={onDelete}
            title="Supprimer"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {replies.length > 0 && (
        <div className="mt-2 space-y-1.5 pl-3 border-l">
          {replies.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="flex items-start gap-1">
                <CornerDownRight className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="whitespace-pre-wrap break-words">{r.body}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDistanceToNow(new Date(r.created_at), {
                        addSuffix: true,
                        locale: fr,
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-destructive"
                      onClick={() => onDeleteReply(r.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {replying && (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={replyBody}
            onChange={(e) => onReplyBodyChange(e.target.value)}
            placeholder="Votre réponse…"
            rows={2}
            className="resize-none text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onCancelReply}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={onSubmitReply}
              disabled={submitting || !replyBody.trim()}
            >
              <Send className="h-3 w-3 mr-1" />
              Répondre
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
