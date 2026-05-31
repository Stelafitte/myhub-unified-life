import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { sendEmail } from "@/lib/api/email-send.functions";

type ComposerAccount = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
};

export type ComposerInitial = {
  mode: "new" | "reply" | "replyAll" | "forward";
  defaultAccountId?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  references?: string;
};

type LocalAttachment = {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  content_base64: string;
};

const SENDABLE_TYPES = new Set(["gmail", "outlook", "imap"]);
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB raw

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export function EmailComposer({
  open,
  onOpenChange,
  accounts,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: ComposerAccount[];
  initial: ComposerInitial;
}) {
  const sendable = accounts.filter((a) => SENDABLE_TYPES.has(a.type));
  const [accountId, setAccountId] = useState<string>(initial.defaultAccountId ?? sendable[0]?.id ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const send = useServerFn(sendEmail);

  useEffect(() => {
    if (open) {
      setAccountId(initial.defaultAccountId ?? sendable[0]?.id ?? "");
      setTo(initial.to ?? "");
      setCc(initial.cc ?? "");
      setBcc("");
      setSubject(initial.subject ?? "");
      setBody(initial.body ?? "");
      setShowCc(!!initial.cc);
      setAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const current = attachments.reduce((n, a) => n + a.size, 0);
    const additions: LocalAttachment[] = [];
    let total = current;
    for (const f of Array.from(files)) {
      total += f.size;
      if (total > MAX_TOTAL_BYTES) {
        toast.error(`Limite de ${formatSize(MAX_TOTAL_BYTES)} atteinte`);
        break;
      }
      try {
        const b64 = await fileToBase64(f);
        additions.push({
          id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
          filename: f.name,
          mime_type: f.type || "application/octet-stream",
          size: f.size,
          content_base64: b64,
        });
      } catch {
        toast.error(`Impossible de lire ${f.name}`);
      }
    }
    if (additions.length) setAttachments((prev) => [...prev, ...additions]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const submit = async () => {
    if (!accountId) return toast.error("Choisir un compte expéditeur");
    if (!to.trim()) return toast.error("Destinataire requis");
    if (!subject.trim()) return toast.error("Sujet requis");
    setBusy(true);
    try {
      await send({
        data: {
          account_id: accountId,
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body,
          in_reply_to: initial.inReplyTo,
          references: initial.references,
          attachments: attachments.length
            ? attachments.map((a) => ({
                filename: a.filename,
                mime_type: a.mime_type,
                content_base64: a.content_base64,
              }))
            : undefined,
        },
      });
      toast.success("Email envoyé");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'envoi");
    } finally {
      setBusy(false);
    }
  };

  const title =
    initial.mode === "reply" || initial.mode === "replyAll" ? "Répondre" :
    initial.mode === "forward" ? "Transférer" : "Nouveau message";

  const totalSize = attachments.reduce((n, a) => n + a.size, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">De</label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="Choisir un compte…" />
              </SelectTrigger>
              <SelectContent>
                {sendable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="mr-1">{a.icon ?? "✉️"}</span> {a.name}
                  </SelectItem>
                ))}
                {sendable.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Aucun compte d'envoi</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">À</label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@exemple.com, bob@…" className="h-9 flex-1" />
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-foreground">Cc/Bcc</button>
            )}
          </div>
          {showCc && (
            <>
              <div className="flex items-center gap-2">
                <label className="w-16 text-xs text-muted-foreground">Cc</label>
                <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9 flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-16 text-xs text-muted-foreground">Bcc</label>
                <Input value={bcc} onChange={(e) => setBcc(e.target.value)} className="h-9 flex-1" />
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">Sujet</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 flex-1" />
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Votre message…"
            className="resize-none"
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={a.filename}>{a.filename}</span>
                  <span className="shrink-0 text-muted-foreground">({formatSize(a.size)})</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Retirer la pièce jointe"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="ml-auto self-center text-[11px] text-muted-foreground">
                {formatSize(totalSize)} / {formatSize(MAX_TOTAL_BYTES)}
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Paperclip className="mr-1 h-4 w-4" /> Joindre
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              <X className="mr-1 h-4 w-4" /> Annuler
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Envoyer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
