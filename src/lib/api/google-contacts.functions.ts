import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Refresh token failed (${res.status}): ${body.error_description ?? body.error ?? "unknown"}`);
  }
  return {
    accessToken: body.access_token as string,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function getValidToken(connectionId: string, userId: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("google_calendar_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !conn) throw new Error("Connection Google introuvable");

  let accessToken = conn.access_token as string;
  if (!conn.expires_at || new Date(conn.expires_at).getTime() <= Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(conn.refresh_token as string);
    accessToken = refreshed.accessToken;
    await supabaseAdmin
      .from("google_calendar_connections")
      .update({ access_token: accessToken, expires_at: refreshed.expiresAt, updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  }
  return { accessToken, connection: conn };
}

type GPerson = {
  resourceName: string;
  names?: Array<{ givenName?: string; familyName?: string; displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string }>;
};

export const syncGoogleContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { accessToken } = await getValidToken(data.connectionId, userId);

    let created = 0;
    let updated = 0;
    let synced = 0;
    const errors: string[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        personFields: "names,emailAddresses,phoneNumbers,organizations,photos",
        pageSize: "200",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(
        `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`People API error (${res.status}): ${body.error?.message ?? "unknown"}`);

      const people: GPerson[] = body.connections ?? [];
      for (const p of people) {
        try {
          const name = p.names?.[0];
          const firstName = name?.givenName ?? null;
          const lastName = name?.familyName ?? null;
          const emails = (p.emailAddresses ?? []).map((e) => e.value).filter(Boolean) as string[];
          const phones = (p.phoneNumbers ?? []).map((e) => e.value).filter(Boolean) as string[];
          const org = p.organizations?.[0];
          const avatar = p.photos?.[0]?.url ?? null;
          const primaryEmail = emails[0];

          let existing: { id: string; sources: string[] | null; external_ids: Record<string, string> | null } | null = null;
          if (primaryEmail) {
            const { data: match } = await supabaseAdmin
              .from("contacts")
              .select("id, sources, external_ids")
              .eq("user_id", userId)
              .contains("email", [primaryEmail])
              .maybeSingle();
            existing = match as typeof existing;
          }
          if (!existing) {
            const { data: byId } = await supabaseAdmin
              .from("contacts")
              .select("id, sources, external_ids")
              .eq("user_id", userId)
              .contains("external_ids", { google: p.resourceName })
              .maybeSingle();
            existing = byId as typeof existing;
          }

          if (existing) {
            const mergedSources = Array.from(new Set([...(existing.sources ?? []), "google"]));
            const mergedExt = { ...(existing.external_ids ?? {}), google: p.resourceName };
            await supabaseAdmin
              .from("contacts")
              .update({
                first_name: firstName ?? undefined,
                last_name: lastName ?? undefined,
                email: emails.length ? emails : undefined,
                phone: phones.length ? phones : undefined,
                organization: org?.name ?? undefined,
                role: org?.title ?? undefined,
                avatar_url: avatar ?? undefined,
                sources: mergedSources,
                external_ids: mergedExt,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            updated += 1;
          } else {
            await supabaseAdmin.from("contacts").insert({
              user_id: userId,
              first_name: firstName,
              last_name: lastName,
              email: emails,
              phone: phones,
              organization: org?.name ?? null,
              role: org?.title ?? null,
              avatar_url: avatar,
              sources: ["google"],
              external_ids: { google: p.resourceName },
            });
            created += 1;
          }
          synced += 1;
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      pageToken = body.nextPageToken as string | undefined;
    } while (pageToken);

    return { synced, created, updated, errors };
  });

export const pushContactToGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ contactId: z.string().uuid(), connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { accessToken } = await getValidToken(data.connectionId, userId);

    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !contact) throw new Error("Contact introuvable");

    const payload = {
      names: [{ givenName: contact.first_name ?? "", familyName: contact.last_name ?? "" }],
      emailAddresses: (contact.email ?? []).map((value: string) => ({ value })),
      phoneNumbers: (contact.phone ?? []).map((value: string) => ({ value })),
      organizations: contact.organization
        ? [{ name: contact.organization, title: contact.role ?? undefined }]
        : [],
    };

    const res = await fetch("https://people.googleapis.com/v1/people:createContact", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`People API push (${res.status}): ${body.error?.message ?? "unknown"}`);

    const ext = { ...((contact.external_ids as Record<string, string>) ?? {}), google: body.resourceName };
    const sources = Array.from(new Set([...((contact.sources as string[]) ?? []), "google"]));
    await supabaseAdmin
      .from("contacts")
      .update({ external_ids: ext, sources, updated_at: new Date().toISOString() })
      .eq("id", contact.id);

    return { ok: true, resourceName: body.resourceName as string };
  });
