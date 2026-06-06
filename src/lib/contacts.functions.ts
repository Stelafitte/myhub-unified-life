import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Types & Schemas
// ============================================================

export const GROUP_TYPES = ["manual", "smart", "space", "whatsapp"] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

const SmartRulesSchema = z
  .object({
    org_contains: z.string().optional(),
    tag_contains: z.string().optional(),
    source: z.enum(["google", "icloud", "outlook"]).optional(),
    email_domain: z.string().optional(),
    in_space_id: z.string().uuid().optional(),
    attended_meeting_in_space_id: z.string().uuid().optional(),
    emailed_within_days: z.number().int().positive().max(365).optional(),
  })
  .partial();

export type SmartRules = z.infer<typeof SmartRulesSchema>;

const MemberInputSchema = z.object({
  contact_id: z.string().uuid().optional(),
  external_email: z.string().email().optional(),
  external_name: z.string().max(200).optional(),
  added_by: z.enum(["manual", "ai", "space", "whatsapp"]).default("manual"),
});

// ============================================================
// Helpers
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function recountMembers(supabase: SB, groupId: string) {
  const { count } = await supabase
    .from("contact_group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId);
  await supabase
    .from("collab_contact_groups")
    .update({ member_count: count ?? 0 })
    .eq("id", groupId);
  return count ?? 0;
}

async function computeSmartMembers(
  supabase: SB,
  userId: string,
  rules: SmartRules,
): Promise<string[]> {
  // Start from all user's contacts.
  let q = supabase.from("contacts").select("id, organization, tags, sources, email").eq("user_id", userId);
  const { data: contacts, error } = await q;
  if (error) throw new Error(error.message);

  let pool = (contacts ?? []) as Array<{
    id: string;
    organization: string | null;
    tags: string[] | null;
    sources: string[] | null;
    email: string[] | null;
  }>;

  if (rules.org_contains) {
    const v = rules.org_contains.toLowerCase();
    pool = pool.filter((c) => (c.organization ?? "").toLowerCase().includes(v));
  }
  if (rules.tag_contains) {
    const v = rules.tag_contains.toLowerCase();
    pool = pool.filter((c) => (c.tags ?? []).some((t) => t.toLowerCase().includes(v)));
  }
  if (rules.source) {
    const v = rules.source.toLowerCase();
    pool = pool.filter((c) => (c.sources ?? []).some((s) => s.toLowerCase().includes(v)));
  }
  if (rules.email_domain) {
    const v = rules.email_domain.toLowerCase().replace(/^@/, "");
    pool = pool.filter((c) =>
      (c.email ?? []).some((e) => e.toLowerCase().endsWith("@" + v)),
    );
  }

  // Emailed within N days → restrict by from_address presence in emails
  if (rules.emailed_within_days) {
    const since = new Date(Date.now() - rules.emailed_within_days * 86400_000).toISOString();
    const { data: ems } = await supabase
      .from("emails")
      .select("from_address")
      .eq("user_id", userId)
      .gte("received_at", since)
      .not("from_address", "is", null)
      .limit(5000);
    const set = new Set<string>(
      ((ems ?? []) as { from_address: string | null }[])
        .map((e) => (e.from_address ?? "").toLowerCase())
        .filter(Boolean),
    );
    pool = pool.filter((c) => (c.email ?? []).some((e) => set.has(e.toLowerCase())));
  }

  // Attended meeting in space
  if (rules.attended_meeting_in_space_id) {
    // We don't have direct space↔meeting link; fallback to meeting_participants for the user
    const { data: parts } = await supabase
      .from("meeting_participants")
      .select("email, contact_id")
      .eq("user_id", userId);
    const emailSet = new Set<string>();
    const contactSet = new Set<string>();
    for (const p of (parts ?? []) as { email: string | null; contact_id: string | null }[]) {
      if (p.contact_id) contactSet.add(p.contact_id);
      if (p.email) emailSet.add(p.email.toLowerCase());
    }
    pool = pool.filter(
      (c) => contactSet.has(c.id) || (c.email ?? []).some((e) => emailSet.has(e.toLowerCase())),
    );
  }

  return pool.map((c) => c.id);
}

async function collectSpaceMembers(
  supabase: SB,
  userId: string,
  spaceId: string,
): Promise<{ contactIds: Set<string>; externalEmails: Set<string> }> {
  const contactIds = new Set<string>();
  const externalEmails = new Set<string>();

  // 1) meeting_participants for meetings touching this space (best-effort: all owned)
  const { data: parts } = await supabase
    .from("meeting_participants")
    .select("email, contact_id")
    .eq("user_id", userId);
  for (const p of (parts ?? []) as { email: string | null; contact_id: string | null }[]) {
    if (p.contact_id) contactIds.add(p.contact_id);
    else if (p.email) externalEmails.add(p.email.toLowerCase());
  }

  // 2) WhatsApp messages senders in this space (collab_messages with metadata)
  const { data: msgs } = await supabase
    .from("collab_messages")
    .select("sender_name, metadata")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .limit(2000);
  for (const m of (msgs ?? []) as { sender_name: string | null; metadata: Record<string, unknown> | null }[]) {
    const meta = m.metadata ?? {};
    const phone = typeof meta["phone"] === "string" ? (meta["phone"] as string) : null;
    const email = typeof meta["email"] === "string" ? (meta["email"] as string).toLowerCase() : null;
    if (email) externalEmails.add(email);
    else if (m.sender_name && !phone) externalEmails.add(`wa:${m.sender_name}`);
    else if (phone) externalEmails.add(`wa:${phone}`);
  }

  return { contactIds, externalEmails };
}

async function collectWhatsAppSenders(
  supabase: SB,
  userId: string,
  spaceId: string,
): Promise<Array<{ name: string | null; key: string }>> {
  const { data: msgs } = await supabase
    .from("collab_messages")
    .select("sender_name, metadata")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .limit(5000);
  const seen = new Map<string, { name: string | null; key: string }>();
  for (const m of (msgs ?? []) as { sender_name: string | null; metadata: Record<string, unknown> | null }[]) {
    const meta = m.metadata ?? {};
    const phone = typeof meta["phone"] === "string" ? (meta["phone"] as string) : null;
    const key = (phone || m.sender_name || "").trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { name: m.sender_name, key });
  }
  return Array.from(seen.values());
}

// ============================================================
// listContactGroups
// ============================================================

export const listContactGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("collab_contact_groups")
      .select(
        "id, name, description, group_type, source, color, icon, space_id, is_smart, smart_rules, last_synced_at, member_count, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Pull space names in one shot
    const spaceIds = Array.from(
      new Set(
        (data ?? [])
          .map((g: { space_id: string | null }) => g.space_id)
          .filter((x: string | null): x is string => !!x),
      ),
    );
    let spacesById: Record<string, { name: string; color: string | null }> = {};
    if (spaceIds.length > 0) {
      const { data: spaces } = await supabase
        .from("collab_spaces")
        .select("id, name, color")
        .in("id", spaceIds);
      spacesById = Object.fromEntries(
        ((spaces ?? []) as { id: string; name: string; color: string | null }[]).map((s) => [
          s.id,
          { name: s.name, color: s.color },
        ]),
      );
    }

    return {
      groups: (data ?? []).map((g: Record<string, unknown>) => ({
        ...g,
        space: g.space_id ? spacesById[g.space_id as string] ?? null : null,
      })),
    };
  });

// ============================================================
// getGroupMembers
// ============================================================

export const getGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ groupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // ownership check via group
    const { data: grp } = await supabase
      .from("collab_contact_groups")
      .select("id, user_id, name, group_type, smart_rules, space_id, last_synced_at")
      .eq("id", data.groupId)
      .single();
    if (!grp || grp.user_id !== userId) throw new Error("Groupe introuvable");

    const { data: rows, error } = await supabase
      .from("contact_group_members")
      .select("id, contact_id, external_email, external_name, added_by, created_at")
      .eq("group_id", data.groupId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const contactIds = (rows ?? [])
      .map((r: { contact_id: string | null }) => r.contact_id)
      .filter((x: string | null): x is string => !!x);
    let byId: Record<string, unknown> = {};
    if (contactIds.length > 0) {
      const { data: cs } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, organization, email, avatar_url")
        .in("id", contactIds);
      byId = Object.fromEntries(((cs ?? []) as { id: string }[]).map((c) => [c.id, c]));
    }

    return {
      group: grp,
      members: (rows ?? []).map((r: { contact_id: string | null }) => ({
        ...r,
        contact: r.contact_id ? byId[r.contact_id] ?? null : null,
      })),
    };
  });

// ============================================================
// createContactGroup
// ============================================================

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  group_type: z.enum(GROUP_TYPES).default("manual"),
  space_id: z.string().uuid().nullable().optional(),
  color: z.string().max(40).optional(),
  icon: z.string().max(40).optional(),
  smart_rules: SmartRulesSchema.optional(),
  // Initial members for manual groups
  initial_contact_ids: z.array(z.string().uuid()).max(2000).optional(),
  initial_external_emails: z.array(z.string().email()).max(2000).optional(),
  // For type=whatsapp: optional sender keys to import as external members
  whatsapp_senders: z
    .array(z.object({ name: z.string().nullable().optional(), key: z.string() }))
    .max(2000)
    .optional(),
  source: z.enum(["user", "ai", "whatsapp", "space"]).default("user"),
});

export const createContactGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateGroupSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isSmart = data.group_type === "smart";
    const { data: grp, error } = await supabase
      .from("collab_contact_groups")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description ?? null,
        group_type: data.group_type,
        source: data.source,
        color: data.color ?? null,
        icon: data.icon ?? null,
        space_id: data.space_id ?? null,
        is_smart: isSmart,
        smart_rules: data.smart_rules ?? {},
      })
      .select()
      .single();
    if (error || !grp) throw new Error(error?.message || "Création échouée");

    const groupId = grp.id as string;
    const addedBy: "manual" | "ai" | "space" | "whatsapp" =
      data.group_type === "space"
        ? "space"
        : data.group_type === "whatsapp"
          ? "whatsapp"
          : data.source === "ai"
            ? "ai"
            : "manual";

    // Resolve initial members based on type
    if (data.group_type === "smart") {
      const ids = await computeSmartMembers(supabase, userId, data.smart_rules ?? {});
      if (ids.length > 0) {
        await supabase.from("contact_group_members").insert(
          ids.map((cid) => ({ group_id: groupId, contact_id: cid, added_by: "ai" as const })),
        );
      }
      await supabase
        .from("collab_contact_groups")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", groupId);
    } else if (data.group_type === "space" && data.space_id) {
      const { contactIds, externalEmails } = await collectSpaceMembers(
        supabase,
        userId,
        data.space_id,
      );
      type MemberRow = {
        group_id: string;
        contact_id?: string | null;
        external_email?: string | null;
        external_name?: string | null;
        added_by: "manual" | "ai" | "space" | "whatsapp";
      };
      const rows: MemberRow[] = [];
      contactIds.forEach((cid) =>
        rows.push({ group_id: groupId, contact_id: cid, added_by: "space" as const }),
      );
      externalEmails.forEach((em) => {
        if (em.startsWith("wa:")) {
          rows.push({
            group_id: groupId,
            external_name: em.slice(3),
            external_email: `${em.slice(3).replace(/\s+/g, "_")}@wa.local`,
            added_by: "space" as const,
          });
        } else {
          rows.push({ group_id: groupId, external_email: em, added_by: "space" as const });
        }
      });
      if (rows.length > 0) await supabase.from("contact_group_members").insert(rows);
    } else if (data.group_type === "whatsapp" && data.whatsapp_senders) {
      const rows = data.whatsapp_senders.map((s) => ({
        group_id: groupId,
        external_name: s.name ?? s.key,
        external_email: `${s.key.replace(/\s+/g, "_")}@wa.local`,
        added_by: "whatsapp" as const,
      }));
      if (rows.length > 0) await supabase.from("contact_group_members").insert(rows);
    } else {
      // Manual
      type MemberRow = {
        group_id: string;
        contact_id?: string | null;
        external_email?: string | null;
        external_name?: string | null;
        added_by: "manual" | "ai" | "space" | "whatsapp";
      };
      const rows: MemberRow[] = [];
      (data.initial_contact_ids ?? []).forEach((cid) =>
        rows.push({ group_id: groupId, contact_id: cid, added_by: addedBy }),
      );
      (data.initial_external_emails ?? []).forEach((em) =>
        rows.push({ group_id: groupId, external_email: em, added_by: addedBy }),
      );
      if (rows.length > 0) await supabase.from("contact_group_members").insert(rows);
    }

    const count = await recountMembers(supabase, groupId);
    return { group: { ...grp, member_count: count } };
  });

// ============================================================
// updateContactGroup
// ============================================================

const UpdateGroupSchema = z.object({
  groupId: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    color: z.string().max(40).nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
    space_id: z.string().uuid().nullable().optional(),
    smart_rules: SmartRulesSchema.optional(),
  }),
});

export const updateContactGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateGroupSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_contact_groups")
      .update(data.patch)
      .eq("id", data.groupId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// deleteContactGroup
// ============================================================

export const deleteContactGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ groupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collab_contact_groups")
      .delete()
      .eq("id", data.groupId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// duplicateContactGroup
// ============================================================

export const duplicateContactGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ groupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: src } = await supabase
      .from("collab_contact_groups")
      .select("*")
      .eq("id", data.groupId)
      .eq("user_id", userId)
      .single();
    if (!src) throw new Error("Groupe introuvable");
    const { data: copy, error } = await supabase
      .from("collab_contact_groups")
      .insert({
        user_id: userId,
        name: `${src.name} (copie)`,
        description: src.description,
        group_type: src.group_type,
        source: src.source,
        color: src.color,
        icon: src.icon,
        space_id: src.space_id,
        is_smart: src.is_smart,
        smart_rules: src.smart_rules,
      })
      .select()
      .single();
    if (error || !copy) throw new Error(error?.message || "Duplication échouée");
    // Copy members
    const { data: members } = await supabase
      .from("contact_group_members")
      .select("contact_id, external_email, external_name, added_by")
      .eq("group_id", data.groupId);
    if (members && members.length > 0) {
      await supabase
        .from("contact_group_members")
        .insert(members.map((m: Record<string, unknown>) => ({ ...m, group_id: copy.id })));
    }
    await recountMembers(supabase, copy.id);
    return { groupId: copy.id };
  });

// ============================================================
// addGroupMembers / removeGroupMember
// ============================================================

const AddMembersSchema = z.object({
  groupId: z.string().uuid(),
  members: z.array(MemberInputSchema).min(1).max(2000),
});

export const addGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddMembersSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // ownership
    const { data: grp } = await supabase
      .from("collab_contact_groups")
      .select("id, user_id")
      .eq("id", data.groupId)
      .single();
    if (!grp || grp.user_id !== userId) throw new Error("Groupe introuvable");

    const rows = data.members.map((m) => ({
      group_id: data.groupId,
      contact_id: m.contact_id ?? null,
      external_email: m.external_email ?? null,
      external_name: m.external_name ?? null,
      added_by: m.added_by,
    }));
    const { error } = await supabase
      .from("contact_group_members")
      .upsert(rows, { onConflict: "group_id,contact_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    const count = await recountMembers(supabase, data.groupId);
    return { ok: true, member_count: count };
  });

export const removeGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ groupId: z.string().uuid(), memberId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: grp } = await supabase
      .from("collab_contact_groups")
      .select("id, user_id")
      .eq("id", data.groupId)
      .single();
    if (!grp || grp.user_id !== userId) throw new Error("Groupe introuvable");
    const { error } = await supabase
      .from("contact_group_members")
      .delete()
      .eq("id", data.memberId)
      .eq("group_id", data.groupId);
    if (error) throw new Error(error.message);
    const count = await recountMembers(supabase, data.groupId);
    return { ok: true, member_count: count };
  });

// ============================================================
// syncSmartGroup
// ============================================================

export const syncSmartGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ groupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: grp } = await supabase
      .from("collab_contact_groups")
      .select("*")
      .eq("id", data.groupId)
      .eq("user_id", userId)
      .single();
    if (!grp) throw new Error("Groupe introuvable");
    if (!grp.is_smart) throw new Error("Ce groupe n'est pas dynamique");

    const wantedIds = new Set(
      await computeSmartMembers(supabase, userId, (grp.smart_rules ?? {}) as SmartRules),
    );

    const { data: current } = await supabase
      .from("contact_group_members")
      .select("id, contact_id")
      .eq("group_id", data.groupId);

    const currentByContact = new Map<string, string>(); // contact_id -> member_id
    const toRemove: string[] = [];
    for (const m of (current ?? []) as { id: string; contact_id: string | null }[]) {
      if (m.contact_id) {
        if (wantedIds.has(m.contact_id)) currentByContact.set(m.contact_id, m.id);
        else toRemove.push(m.id);
      }
    }
    const toAdd: string[] = [];
    wantedIds.forEach((id) => {
      if (!currentByContact.has(id)) toAdd.push(id);
    });

    if (toRemove.length > 0) {
      await supabase.from("contact_group_members").delete().in("id", toRemove);
    }
    if (toAdd.length > 0) {
      await supabase.from("contact_group_members").insert(
        toAdd.map((cid) => ({ group_id: data.groupId, contact_id: cid, added_by: "ai" as const })),
      );
    }
    const now = new Date().toISOString();
    await supabase
      .from("collab_contact_groups")
      .update({ last_synced_at: now })
      .eq("id", data.groupId);
    const count = await recountMembers(supabase, data.groupId);
    return { added: toAdd.length, removed: toRemove.length, member_count: count, last_synced_at: now };
  });

// ============================================================
// listSpaces (helper for dropdowns inside the contacts module)
// ============================================================

export const listCollabSpacesForGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("collab_spaces")
      .select("id, name, parent_id, color, icon, level")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return { spaces: data ?? [] };
  });

// ============================================================
// listWhatsAppSendersForSpace
// ============================================================

export const listWhatsAppSendersForSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ spaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const senders = await collectWhatsAppSenders(supabase, userId, data.spaceId);
    return { senders };
  });

// ============================================================
// getContactGroupMemberships (used in contact card)
// ============================================================

export const getContactGroupMemberships = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("contact_group_members")
      .select("group_id")
      .eq("contact_id", data.contactId);
    const ids = Array.from(
      new Set(((rows ?? []) as { group_id: string }[]).map((r) => r.group_id)),
    );
    if (ids.length === 0) return { groups: [] };
    const { data: groups } = await supabase
      .from("collab_contact_groups")
      .select("id, name, color, icon, group_type, space_id")
      .in("id", ids)
      .eq("user_id", userId);
    return { groups: groups ?? [] };
  });

// ============================================================
// suggestGroupsFromContext (AI)
// ============================================================

export const suggestGroupsFromContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: contacts }, { data: spaces }] = await Promise.all([
      supabase
        .from("contacts")
        .select("first_name, last_name, organization, email, tags")
        .eq("user_id", userId)
        .limit(500),
      supabase
        .from("collab_spaces")
        .select("id, name, type")
        .eq("user_id", userId)
        .is("archived_at", null)
        .limit(80),
    ]);

    // Heuristic suggestions: top organizations + top email domains + each space
    const orgCount = new Map<string, number>();
    const domainCount = new Map<string, number>();
    for (const c of (contacts ?? []) as {
      organization: string | null;
      email: string[] | null;
    }[]) {
      if (c.organization) orgCount.set(c.organization, (orgCount.get(c.organization) ?? 0) + 1);
      for (const e of c.email ?? []) {
        const at = e.lastIndexOf("@");
        if (at > 0) {
          const d = e.slice(at + 1).toLowerCase();
          if (!/^(gmail|outlook|hotmail|yahoo|icloud|live|orange|free|wanadoo)\./.test(d))
            domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
        }
      }
    }
    const suggestions: Array<{
      title: string;
      reason: string;
      group_type: GroupType;
      smart_rules?: SmartRules;
      space_id?: string;
    }> = [];

    Array.from(orgCount.entries())
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([org, n]) =>
        suggestions.push({
          title: `Équipe ${org}`,
          reason: `${n} contacts partagent l'organisation « ${org} »`,
          group_type: "smart",
          smart_rules: { org_contains: org },
        }),
      );

    Array.from(domainCount.entries())
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([dom, n]) =>
        suggestions.push({
          title: `Domaine @${dom}`,
          reason: `${n} contacts ont une adresse @${dom}`,
          group_type: "smart",
          smart_rules: { email_domain: dom },
        }),
      );

    ((spaces ?? []) as { id: string; name: string }[]).slice(0, 2).forEach((s) =>
      suggestions.push({
        title: `Membres ${s.name}`,
        reason: `Membres de l'espace collaboratif « ${s.name} »`,
        group_type: "space",
        space_id: s.id,
      }),
    );

    return { suggestions: suggestions.slice(0, 5) };
  });
