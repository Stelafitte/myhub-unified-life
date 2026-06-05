import { promptDialog } from "@/lib/confirm-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, Italic, Underline, List, Link2, Loader2, Paperclip, Send, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { sendEmail } from "@/lib/api/email-send.functions";
import { RecipientInput } from "@/components/inbox/recipient-input";
import { getSignatureForAccount } from "@/lib/email-signatures";
import { cn } from "@/lib/utils";

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
const ORIGINAL_MARKER = "--- Message original ---";
const LAST_ACCOUNT_KEY = "composer:lastAccountByRecipient";

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

/**
 * Split an initial body into the writable head and the quoted "original
 * message" tail. Recognises both reply ("Le … a écrit :") and forward
 * ("---------- Message transféré ----------") markers built by the inbox.
 */
function splitQuoted(body: string): { head: string; quoted: string } {
  if (!body) return { head: "", quoted: "" };
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^Le .* a écrit\s*:\s*$/.test(ln) || /Message transféré/.test(ln)) {
      const head = lines.slice(0, i).join("\n").replace(/\s+$/g, "");
      const quoted = lines.slice(i).join("\n").replace(/^[\s>]*\n/, "");
      return { head, quoted };
    }
  }
  return { head: body, quoted: "" };
}

function firstEmail(input: string): string | null {
  const m = input.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function loadLastAccountMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveLastAccount(recipient: string, accountId: string) {
  try {
    const map = loadLastAccountMap();
    map[recipient] = accountId;
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
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
  const initialSplit = useMemo(() => splitQuoted(initial.body ?? ""), [initial.body]);

  const [accountId, setAccountId] = useState<string>(initial.defaultAccountId ?? sendable[0]?.id ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [cc, setCc] = useState(initial.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [replyText, setReplyText] = useState(initialSplit.head);
  const [quoted, setQuoted] = useState(initialSplit.quoted);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initialAttachments ?? []);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const send = useServerFn(sendEmail);

  const currentAccount = sendable.find((a) => a.id === accountId) ?? null;
  const signature = getSignatureForAccount(currentAccount);

  // Réinitialiser à l'ouverture — choisir le compte en mémorisant le dernier utilisé par destinataire.
  useEffect(() => {
    if (!open) return;
    const recipientEmail = firstEmail(initial.to ?? "");
    const lastMap = loadLastAccountMap();
    const remembered = recipientEmail ? lastMap[recipientEmail] : null;
    const nextAccountId =
      (remembered && sendable.some((a) => a.id === remembered) ? remembered : null) ??
      initial.defaultAccountId ??
      sendable[0]?.id ??
      "";
    setAccountId(nextAccountId);
    setTo(initial.to ?? "");
    setCc(initial.cc ?? "");
    setBcc("");
    setSubject(initial.subject ?? "");
    setShowCc(!!initial.cc);
    setAttachments(initialAttachments ?? []);
    const split = splitQuoted(initial.body ?? "");
    setReplyText(split.head);
    setQuoted(split.quoted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const removeAttachment = (i: number) =>
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  // Wrap selection in the reply textarea with markers (toolbar actions).
  const wrapSelection = (before: string, after: string = before) => {
    const ta = replyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const sel = replyText.slice(start, end);
    const next = replyText.slice(0, start) + before + sel + after + replyText.slice(end);
    setReplyText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  };
  const insertList = () => {
    const ta = replyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const insert = "\n- ";
    setReplyText(replyText.slice(0, start) + insert + replyText.slice(start));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + insert.length, start + insert.length);
    });
  };
  const insertLink = () => {
    const url = window.prompt("URL du lien :", "https://");
    if (!url) return;
    wrapSelection("[", `](${url})`);
  };

  const submit = async () => {
    if (!accountId) return toast.error("Choisir un compte expéditeur");
    if (!to.trim()) return toast.error("Destinataire requis");
    if (!subject.trim()) return toast.error("Sujet requis");
    setBusy(true);
    try {
      // Assemble: reply text → signature → original message
      const parts: string[] = [];
      parts.push(replyText.replace(/\s+$/g, ""));
      parts.push("");
      parts.push("-- ");
      parts.push(signature);
      if (quoted.trim()) {
        parts.push("");
        parts.push(ORIGINAL_MARKER);
        parts.push("");
        parts.push(quoted);
      }
      const body = parts.join("\n");

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
      const recipient = firstEmail(to);
      if (recipient) saveLastAccount(recipient, accountId);
      toast.success("Email envoyé");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'envoi");
    } finally {
      setBusy(false);
    }
  };

  const title =
    initial.mode === "reply" || initial.mode === "replyAll"
      ? "Répondre"
      : initial.mode === "forward"
        ? "Transférer"
        : "Nouveau message";

  const totalAttachSize = attachments.reduce((a, b) => a + b.size, 0);
  const accountEmail =
    (currentAccount?.credentials?.username as string | undefined) ??
    (currentAccount?.credentials?.email as string | undefined) ??
    (currentAccount?.credentials?.address as string | undefined) ??
    "";
  const accountBorderColor = currentAccount?.color ?? "var(--primary)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {/* Sélecteur de compte expéditeur */}
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">De</label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="Choisir un compte…" />
              </SelectTrigger>
              <SelectContent>
                {sendable.map((a) => {
                  const email =
                    (a.credentials?.username as string | undefined) ??
                    (a.credentials?.email as string | undefined) ??
                    (a.credentials?.address as string | undefined) ??
                    "";
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="mr-1">{a.icon ?? "✉️"}</span>
                      <span className="font-medium">{a.name}</span>
                      {email && (
                        <span className="ml-2 text-xs text-muted-foreground">{email}</span>
                      )}
                    </SelectItem>
                  );
                })}
                {sendable.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Aucun compte d'envoi
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">À</label>
            <RecipientInput value={to} onChange={setTo} placeholder="alice@exemple.com, bob@…" />
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cc/Bcc
              </button>
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
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-9 flex-1"
            />
          </div>

          {/* Toolbar de formatage */}
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
            <ToolbarBtn label="Gras" onClick={() => wrapSelection("**")}>
              <Bold className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <ToolbarBtn label="Italique" onClick={() => wrapSelection("*")}>
              <Italic className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <ToolbarBtn label="Souligné" onClick={() => wrapSelection("__")}>
              <Underline className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <ToolbarBtn label="Liste" onClick={insertList}>
              <List className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <ToolbarBtn label="Lien" onClick={insertLink}>
              <Link2 className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <div className="mx-1 h-4 w-px bg-border" />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={onPickFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Joindre un fichier"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Joindre
              {attachments.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                  {attachments.length}
                </span>
              )}
            </button>
          </div>

          {/* Zone de saisie de la réponse */}
          <Textarea
            ref={replyRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Votre message…"
            className="min-h-[120px] resize-y p-4 text-[14px] leading-relaxed"
          />

          {/* Signature (juste sous la zone de saisie, AVANT le fil précédent) */}
          {signature && (
            <div className="border-t border-border pt-2 text-[13px] text-muted-foreground whitespace-pre-wrap">
              {signature}
            </div>
          )}

          {/* Séparateur "Message original" + fil précédent */}
          {quoted && (
            <>
              <div className="flex items-center gap-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>{ORIGINAL_MARKER}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div
                className="rounded-md bg-muted/40 p-3 text-[13px] text-muted-foreground whitespace-pre-wrap"
                style={{ borderLeft: `2px solid ${accountBorderColor}` }}
              >
                <QuotedBlock raw={quoted} />
              </div>
            </>
          )}

          {attachments.length > 0 && (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">
                {attachments.length} pièce{attachments.length > 1 ? "s" : ""} jointe
                {attachments.length > 1 ? "s" : ""} · {formatSize(totalAttachSize)} / 20 Mo
              </div>
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatSize(a.size)}
                    </span>
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

        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border px-6 py-3 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Annuler
            </Button>
            {accountEmail && (
              <span className="text-[11px] text-muted-foreground">
                Envoyé depuis <span className="font-medium text-foreground">{accountEmail}</span>
              </span>
            )}
          </div>
          <Button onClick={submit} disabled={busy} className="min-w-[110px]">
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolbarBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground",
        "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Render the quoted original message with a structured header:
 * "De: …" / "Date: …" / "Objet: …" in bold labels, body below.
 */
function QuotedBlock({ raw }: { raw: string }) {
  const lines = raw.split("\n");
  // Header detection — forward style ("De: ", "Date: ", "Sujet: ", "À: ")
  const headerKeys = ["De:", "De :", "Date:", "Date :", "Sujet:", "Sujet :", "Objet:", "Objet :", "À:", "À :"];
  const headerLines: { label: string; value: string }[] = [];
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) {
      if (headerLines.length > 0) {
        bodyStart = i + 1;
        break;
      }
      continue;
    }
    const match = headerKeys.find((k) => ln.startsWith(k));
    if (match) {
      const value = ln.slice(match.length).trim();
      headerLines.push({ label: match.replace(/\s*:$/, ""), value });
    } else if (/^Le .* a écrit\s*:?$/.test(ln)) {
      // Reply marker — show as header line
      headerLines.push({ label: "", value: ln });
      bodyStart = i + 1;
      break;
    } else if (/Message transféré/.test(ln)) {
      // Skip pure separator lines
      continue;
    } else {
      bodyStart = i;
      break;
    }
  }
  const body = lines
    .slice(bodyStart)
    .join("\n")
    .replace(/^[\s>]*\n+/, "")
    .trimEnd();

  return (
    <div className="space-y-2">
      {headerLines.length > 0 && (
        <div className="space-y-0.5">
          {headerLines.map((h, i) => (
            <div key={i} className="text-[12px]">
              {h.label ? (
                <>
                  <span className="font-semibold text-foreground">{h.label} :</span>{" "}
                  <span>{h.value}</span>
                </>
              ) : (
                <span className="italic">{h.value}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {body && <div className="whitespace-pre-wrap text-muted-foreground">{body}</div>}
    </div>
  );
}
