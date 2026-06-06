import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getValidOutlookToken } from "./outlook-oauth.functions";

const GRAPH = "https://graph.microsoft.com/v1.0";

type OContact = {
  id: string;
  givenName?: string;
  surname?: string;
  displayName?: string;
  emailAddresses?: Array<{ address?: string; name?: string }>;
  businessPhones?: string[];
  homePhones?: string[];
  mobilePhone?: string;
  companyName?: string;
  jobTitle?: string;
};

type ExistingContact = {
  id: string;
  sources: string[] | null;
  external_ids: Record<string, string> | null;
};

export const syncOutlookContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { accessToken } = await getValidOutlookToken(data.connectionId, userId);

    let created = 0;
    let updated = 0;
    let synced = 0;
    const errors: string[] = [];

    let nextLink: string | null = `${GRAPH}/me/contacts?$top=100`;
    while (nextLink) {
      const res: Response = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body: { value?: OContact[]; ["@odata.nextLink"]?: string; error?: { message?: string } } =
        await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Outlook contacts error (${res.status}): ${body.error?.message ?? "unknown"}`);
      const contacts = body.value ?? [];

      for (const c of contacts) {
        try {
          const emails = (c.emailAddresses ?? []).map((e) => e.address).filter(Boolean) as string[];
          const phones = [
            ...(c.businessPhones ?? []),
            ...(c.homePhones ?? []),
            ...(c.mobilePhone ? [c.mobilePhone] : []),
          ].filter(Boolean);
          const primaryEmail = emails[0];

          let existing: ExistingContact | null = null;
          if (primaryEmail) {
            const { data: match } = await supabaseAdmin
              .from("contacts")
              .select("id, sources, external_ids")
              .eq("user_id", userId)
              .contains("email", [primaryEmail])
              .maybeSingle();
            existing = (match as ExistingContact | null) ?? null;
          }
          if (!existing) {
            const { data: byId } = await supabaseAdmin
              .from("contacts")
              .select("id, sources, external_ids")
              .eq("user_id", userId)
              .contains("external_ids", { outlook: c.id })
              .maybeSingle();
            existing = (byId as ExistingContact | null) ?? null;
          }

          if (existing) {
            const mergedSources = Array.from(new Set([...(existing.sources ?? []), "outlook"]));
            const mergedExt = { ...(existing.external_ids ?? {}), outlook: c.id };
            await supabaseAdmin
              .from("contacts")
              .update({
                first_name: c.givenName ?? undefined,
                last_name: c.surname ?? undefined,
                email: emails.length ? emails : undefined,
                phone: phones.length ? phones : undefined,
                organization: c.companyName ?? undefined,
                role: c.jobTitle ?? undefined,
                sources: mergedSources,
                external_ids: mergedExt,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            updated += 1;
          } else {
            await supabaseAdmin.from("contacts").insert({
              user_id: userId,
              first_name: c.givenName ?? null,
              last_name: c.surname ?? null,
              email: emails,
              phone: phones,
              organization: c.companyName ?? null,
              role: c.jobTitle ?? null,
              sources: ["outlook"],
              external_ids: { outlook: c.id },
            });
            created += 1;
          }
          synced += 1;
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      nextLink = body["@odata.nextLink"] ?? null;
    }

    return { synced, created, updated, errors };
  });

export const pushContactToOutlook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ contactId: z.string().uuid(), connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { accessToken } = await getValidOutlookToken(data.connectionId, userId);

    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !contact) throw new Error("Contact introuvable");

    const payload = {
      givenName: contact.first_name ?? "",
      surname: contact.last_name ?? "",
      emailAddresses: (contact.email ?? []).map((address: string) => ({ address, name: address })),
      businessPhones: (contact.phone ?? []) as string[],
      companyName: contact.organization ?? undefined,
      jobTitle: contact.role ?? undefined,
    };

    const res = await fetch(`${GRAPH}/me/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Outlook push (${res.status}): ${body.error?.message ?? "unknown"}`);

    const ext = { ...((contact.external_ids as Record<string, string>) ?? {}), outlook: body.id };
    const sources = Array.from(new Set([...((contact.sources as string[]) ?? []), "outlook"]));
    await supabaseAdmin
      .from("contacts")
      .update({ external_ids: ext, sources, updated_at: new Date().toISOString() })
      .eq("id", contact.id);

    return { ok: true, outlookId: body.id as string };
  });
