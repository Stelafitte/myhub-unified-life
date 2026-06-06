import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseVCard } from "@/lib/vcard";
import { decryptSecret, encryptSecret } from "./icloud-crypto.server";

const ICLOUD_ROOT = "https://contacts.icloud.com";

function authHeader(appleId: string, appPassword: string) {
  return "Basic " + Buffer.from(`${appleId}:${appPassword}`).toString("base64");
}

async function davRequest(url: string, method: string, auth: string, body: string | null, depth = "0") {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: body ?? undefined,
    redirect: "follow",
  });
  const text = await res.text();
  if (res.status >= 400) {
    throw new Error(`CardDAV ${method} ${url} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, text, url: res.url };
}

function extractHref(xml: string, tag: string): string | null {
  // Find <tag>...<href>...</href></tag>
  const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>[\\s\\S]*?<(?:\\w+:)?href[^>]*>([^<]+)</(?:\\w+:)?href>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAllHrefs(xml: string): string[] {
  const re = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/gi;
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function absolute(url: string, base: string): string {
  if (url.startsWith("http")) return url;
  const u = new URL(base);
  return `${u.protocol}//${u.host}${url.startsWith("/") ? url : "/" + url}`;
}

async function discoverAddressbook(auth: string): Promise<{ principal: string; addressbook: string }> {
  // 1. current-user-principal on root
  const principalXml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  const r1 = await davRequest(`${ICLOUD_ROOT}/`, "PROPFIND", auth, principalXml, "0");
  const principalHref = extractHref(r1.text, "current-user-principal");
  if (!principalHref) throw new Error("CardDAV principal not found");
  const principalUrl = absolute(principalHref, r1.url);

  // 2. addressbook-home-set
  const homeXml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:addressbook-home-set/></d:prop></d:propfind>`;
  const r2 = await davRequest(principalUrl, "PROPFIND", auth, homeXml, "0");
  const homeHref = extractHref(r2.text, "addressbook-home-set");
  if (!homeHref) throw new Error("CardDAV addressbook-home-set not found");
  const homeUrl = absolute(homeHref, r2.url);

  // 3. list address books, pick first that is an addressbook resourcetype
  const listXml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`;
  const r3 = await davRequest(homeUrl, "PROPFIND", auth, listXml, "1");
  // Find <response> entries containing <addressbook/>
  const responseBlocks = r3.text.split(/<(?:\w+:)?response[\s>]/i).slice(1);
  let addressbookHref: string | null = null;
  for (const block of responseBlocks) {
    if (/<(?:\w+:)?addressbook\s*\/>/i.test(block)) {
      const href = extractHref("<href" + block.split("<href")[1], "href");
      // simpler: extract first href in this block
      const m = block.match(/<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i);
      if (m) {
        addressbookHref = m[1].trim();
        break;
      }
      void href;
    }
  }
  if (!addressbookHref) throw new Error("No CardDAV addressbook found");
  const addressbookUrl = absolute(addressbookHref, r3.url);

  return { principal: principalUrl, addressbook: addressbookUrl };
}

async function fetchAllVCards(addressbookUrl: string, auth: string): Promise<{ href: string; vcard: string; etag: string | null }[]> {
  const reportXml = `<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><c:address-data/></d:prop><c:filter><c:prop-filter name="FN"/></c:filter></c:addressbook-query>`;
  const res = await davRequest(addressbookUrl, "REPORT", auth, reportXml, "1");
  const out: { href: string; vcard: string; etag: string | null }[] = [];
  const blocks = res.text.split(/<(?:\w+:)?response[\s>]/i).slice(1);
  for (const block of blocks) {
    const hrefM = block.match(/<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i);
    const etagM = block.match(/<(?:\w+:)?getetag[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i);
    const dataM = block.match(/<(?:\w+:)?address-data[^>]*>([\s\S]*?)<\/(?:\w+:)?address-data>/i);
    if (!hrefM || !dataM) continue;
    // Decode XML entities
    const raw = dataM[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#13;/g, "\r");
    out.push({ href: hrefM[1].trim(), vcard: raw, etag: etagM ? etagM[1].trim() : null });
  }
  void extractAllHrefs; // keep available
  return out;
}

export const connectICloudContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appleId: z.string().email().max(255),
        appPassword: z.string().min(8).max(64),
        label: z.string().min(1).max(100).optional(),
        category: z.enum(["pro", "perso"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const auth = authHeader(data.appleId, data.appPassword);

    // Verify credentials by discovering principal + addressbook
    const { principal, addressbook } = await discoverAddressbook(auth);

    const enc = encryptSecret(data.appPassword);
    const { data: row, error } = await supabaseAdmin
      .from("icloud_connections")
      .insert({
        user_id: userId,
        label: data.label ?? "iCloud",
        apple_id: data.appleId,
        app_password_encrypted: enc.ciphertext,
        app_password_iv: enc.iv,
        app_password_tag: enc.tag,
        carddav_principal_url: principal,
        carddav_addressbook_url: addressbook,
        category: data.category ?? "perso",
      })
      .select("id, apple_id, label, category, is_active, last_sync_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { connection: row };
  });

export const listICloudConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("icloud_connections")
      .select("id, apple_id, label, category, sync_direction, is_active, last_sync_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { connections: data ?? [] };
  });

export const deleteICloudConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("icloud_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncICloudContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ connectionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: conn, error: connErr } = await supabaseAdmin
      .from("icloud_connections")
      .select("*")
      .eq("id", data.connectionId)
      .eq("user_id", userId)
      .single();
    if (connErr || !conn) throw new Error("iCloud connection not found");

    const password = decryptSecret(conn.app_password_encrypted, conn.app_password_iv, conn.app_password_tag);
    const auth = authHeader(conn.apple_id, password);

    let addressbookUrl = conn.carddav_addressbook_url as string | null;
    if (!addressbookUrl) {
      const d = await discoverAddressbook(auth);
      addressbookUrl = d.addressbook;
      await supabaseAdmin
        .from("icloud_connections")
        .update({ carddav_principal_url: d.principal, carddav_addressbook_url: d.addressbook })
        .eq("id", conn.id);
    }

    const cards = await fetchAllVCards(addressbookUrl, auth);
    let created = 0;
    let updated = 0;

    type ExistingContact = { id: string; sources: string[] | null; external_ids: Record<string, string> | null };

    for (const card of cards) {
      const parsed = parseVCard(card.vcard)[0];
      if (!parsed) continue;
      const email = parsed.email[0] ?? null;
      const externalKey = card.href;

      // Try external_ids.icloud, then email
      let existing: ExistingContact | null = null;
      const byExt = await supabaseAdmin
        .from("contacts")
        .select("id, sources, external_ids")
        .eq("user_id", userId)
        .contains("external_ids", { icloud: externalKey })
        .maybeSingle();
      if (byExt.data) existing = byExt.data as ExistingContact;
      if (!existing && email) {
        const byEmail = await supabaseAdmin
          .from("contacts")
          .select("id, sources, external_ids")
          .eq("user_id", userId)
          .contains("emails", [email])
          .maybeSingle();
        if (byEmail.data) existing = byEmail.data as ExistingContact;
      }

      const payload = {
        first_name: parsed.first_name,
        last_name: parsed.last_name,
        organization: parsed.organization,
        role: parsed.role,
        emails: parsed.email,
        phones: parsed.phone,
        notes: parsed.notes,
      };

      if (existing) {
        const mergedSources = Array.from(new Set([...(existing.sources ?? []), "icloud"]));
        const mergedExt = { ...(existing.external_ids ?? {}), icloud: externalKey };
        const { error: upErr } = await supabaseAdmin
          .from("contacts")
          .update({ ...payload, sources: mergedSources, external_ids: mergedExt, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (!upErr) updated++;
      } else {
        const { error: insErr } = await supabaseAdmin.from("contacts").insert({
          user_id: userId,
          ...payload,
          sources: ["icloud"],
          external_ids: { icloud: externalKey },
        });
        if (!insErr) created++;
      }
    }

    await supabaseAdmin
      .from("icloud_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", conn.id);

    return { created, updated, total: cards.length };
  });
