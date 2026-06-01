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
import { RecipientInput } from "@/components/inbox/recipient-input";
import { applySignature, getSignatureForAccount } from "@/lib/email-signatures";

type ComposerAccount = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
  credentials?: Record<string, unknown> | null;
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

export type ComposerAttachment = {
  name: string;
  type: string;
  size: number;
  contentBase64: string;
};

const SENDABLE_TYPES = new Set(["gmail", "outlook", "imap"]);
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB total

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error ?? new Error("read error"));
    fr.onload = () => {
      const res = fr.result as string;
      const idx = res.indexOf(",");
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    fr.readAsDataURL(file);
  });
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export function EmailComposer({
  open,
  onOpenChange,
  accounts,
  initial,
  initialAttachments,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: ComposerAccount[];
  initial: ComposerInitial;
  initialAttachments?: ComposerAttachment[];
}) {
  const sendable = accounts.filter((a) => SENDABLE_TYPES.has(a.type));
  const [accountId, setAccountId] = useState<string>(initial.defaultAccountId ?? sendable[0]?.id ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initialAttachments ?? []);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const send = useServerFn(sendEmail);

  // Réinitialiser à l'ouverture, en appliquant la signature du compte choisi.
  useEffect(() => {
    if (!open) return;
    const nextAccountId = initial.defaultAccountId ?? sendable[0]?.id ?? "";
    setAccountId(nextAccountId);
    setTo(initial.to ?? "");
    setCc(initial.cc ?? "");
    setBcc("");
    setSubject(initial.subject ?? "");
    setShowCc(!!initial.cc);
    setAttachments(initialAttachments ?? []);
    const acct = sendable.find((a) => a.id === nextAccountId) ?? null;
    const sig = getSignatureForAccount(acct);
    setBody(applySignature(initial.body ?? "", sig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-appliquer la signature quand l'utilisateur change le compte expéditeur.
  useEffect(() => {
    if (!open) return;
    const acct = sendable.find((a) => a.id === accountId) ?? null;
    const sig = getSignatureForAccount(acct);
    setBody((prev) => applySignature(prev, sig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const currentTotal = attachments.reduce((a, b) => a + b.size, 0);
    let runningTotal = currentTotal;
    const next: ComposerAttachment[] = [];
    for (const f of files) {
      if (runningTotal + f.size > MAX_TOTAL_BYTES) {
        toast.error(`"${f.name}" ignoré — limite totale 20 Mo`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(f);
        next.push({ name: f.name, type: f.type || "application/octet-stream", size: f.size, contentBase64 });
        runningTotal += f.size;
      } catch {
        toast.error(`Impossible de lire "${f.name}"`);
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (i: number) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!accountId) return toast.error("Choisir un compte expéditeur");
    if (!to.trim()) return toast.error("Destinataire requis");
    if (!subject.trim()) return toast.error("Sujet requis");
    setBusy(true);
    try {
      await send({
        data: {
          account_id: accountId,
          to: to.trim().replace(/,\s*$/, ""),
          cc: cc.trim().replace(/,\s*$/, "") || undefined,
          bcc: bcc.trim().replace(/,\s*$/, "") || undefined,
          subject: subject.trim(),
          body,
          in_reply_to: initial.inReplyTo,
          references: initial.references,
          attachments: attachments.length > 0 ? attachments : undefined,
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

  const totalAttachSize = attachments.reduce((a, b) => a + b.size, 0);

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
            <RecipientInput value={to} onChange={setTo} placeholder="alice@exemple.com, bob@…" />
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-foreground">Cc/Bcc</button>
            )}
          </div>
          {showCc && (
            <>
              <div className="flex items-center gap-2">
                <label className="w-16 text-xs text-muted-foreground">Cc</label>
                <RecipientInput value={cc} onChange={setCc} />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-16 text-xs text-muted-foreground">Bcc</label>
                <RecipientInput value={bcc} onChange={setBcc} />
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
            rows={14}
            placeholder="Votre message…"
            className="resize-none"
          />
          {attachments.length > 0 && (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">
                {attachments.length} pièce{attachments.length > 1 ? "s" : ""} jointe{attachments.length > 1 ? "s" : ""} · {formatSize(totalAttachSize)} / 20 Mo
              </div>
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatSize(a.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Retirer ${a.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={onPickFiles}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Paperclip className="mr-1 h-4 w-4" /> Joindre
            </Button>
          </div>
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
