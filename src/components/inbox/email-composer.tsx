import { useEffect, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
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

const SENDABLE_TYPES = new Set(["gmail", "outlook", "imap"]);

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
  const [busy, setBusy] = useState(false);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            <X className="mr-1 h-4 w-4" /> Annuler
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
