import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sendSchema = z.object({
  account_id: z.string().uuid(),
  to: z.string().min(3).max(2000),
  cc: z.string().max(2000).optional(),
  bcc: z.string().max(2000).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(0).max(200000),
  in_reply_to: z.string().max(500).optional(),
  references: z.string().max(2000).optional(),
});

function b64url(s: string): string {
  // UTF-8 safe base64url
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRfc2822(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : "",
    opts.bcc ? `Bcc: ${opts.bcc}` : "",
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    opts.references ? `References: ${opts.references}` : "",
  ].filter(Boolean);
  return headers.join("\r\n") + "\r\n\r\n" + opts.body;
}

export const sendEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", data.account_id)
      .eq("user_id", userId)
      .single();
    if (accErr || !account) throw new Error("Compte introuvable");

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;

    if (account.type === "gmail") {
      const GMAIL_KEY = process.env.GOOGLE_MAIL_API_KEY;
      if (!LOVABLE_API_KEY || !GMAIL_KEY) throw new Error("Connecteur Gmail non configuré");
      const raw = b64url(buildRfc2822({
        from: account.name,
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        body: data.body,
        inReplyTo: data.in_reply_to,
        references: data.references,
      }));
      const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GMAIL_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 403) throw new Error("Scope manquant: gmail.send. Reconnectez Gmail avec la permission d'envoi.");
        throw new Error(`Gmail ${res.status}: ${t.slice(0, 200)}`);
      }
      return { ok: true };
    }

    if (account.type === "outlook") {
      const OUTLOOK_KEY = process.env.MICROSOFT_OUTLOOK_API_KEY;
      if (!LOVABLE_API_KEY || !OUTLOOK_KEY) throw new Error("Connecteur Outlook non configuré");
      const toList = data.to.split(",").map((s) => s.trim()).filter(Boolean);
      const ccList = data.cc ? data.cc.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const bccList = data.bcc ? data.bcc.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const res = await fetch("https://connector-gateway.lovable.dev/microsoft_outlook/me/sendMail", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": OUTLOOK_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: data.subject,
            body: { contentType: "Text", content: data.body },
            toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
            ccRecipients: ccList.map((a) => ({ emailAddress: { address: a } })),
            bccRecipients: bccList.map((a) => ({ emailAddress: { address: a } })),
          },
          saveToSentItems: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 403) throw new Error("Scope manquant: Mail.Send. Reconnectez Outlook avec la permission d'envoi.");
        throw new Error(`Outlook ${res.status}: ${t.slice(0, 200)}`);
      }
      return { ok: true };
    }

    if (account.type === "imap") {
      // Delegate to edge function with SMTP
      const SUPABASE_URL = process.env.SUPABASE_URL!;
      const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const authHeader = getRequestHeader("Authorization");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-imap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader ?? `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({
          account_id: data.account_id,
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          text: data.body,
          in_reply_to: data.in_reply_to,
          references: data.references,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `SMTP ${res.status}`);
      }
      return { ok: true };
    }

    throw new Error(`Type de compte non supporté: ${account.type}`);
  });
