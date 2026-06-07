import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Normalize phone to digits only (E.164 without +). */
function normPhone(s: string | null | undefined): string {
  return (s ?? "").replace(/[^\d]/g, "");
}

/**
 * Return the data needed to associate Hub WA spaces (created via export/import)
 * with active WhatsApp Business threads (peers and groups).
 */
export const listWaLinkCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1) Hub spaces with any WA hint (imported via WA export, or already linked)
    const { data: spacesRaw, error: spacesErr } = await supabase
      .from("collab_spaces")
      .select(
        "id,name,whatsapp_phone_number,whatsapp_group_id,wa_group_name,archived_at",
      )
      .is("archived_at", null)
      .eq("user_id", userId);
    if (spacesErr) throw new Error(spacesErr.message);

    const spaces = (spacesRaw ?? []).filter(
      (s) =>
        s.wa_group_name ||
        s.whatsapp_phone_number ||
        s.whatsapp_group_id ||
        (s.name ?? "").toLowerCase().startsWith("wa :"),
    );

    // 2) Active WA Business connections
    const { data: connections, error: connErr } = await supabase
      .from("wa_business_connections")
      .select("id,phone_number,display_name,is_active")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (connErr) throw new Error(connErr.message);

    // 3) Active groups synced from WA Business
    const { data: groups, error: gErr } = await supabase
      .from("wa_groups")
      .select("id,wa_group_id,name,participant_count,connection_id,space_id,last_message_at")
      .eq("user_id", userId);
    if (gErr) throw new Error(gErr.message);

    // 4) Active peer conversations (1:1) derived from wa_messages
    const { data: msgs, error: mErr } = await supabase
      .from("wa_messages")
      .select("connection_id,from_number,from_name,space_id,timestamp,group_id")
      .eq("user_id", userId)
      .is("group_id", null)
      .order("timestamp", { ascending: false })
      .limit(500);
    if (mErr) throw new Error(mErr.message);

    type Peer = {
      connection_id: string;
      peer: string;
      name: string | null;
      last: string;
      count: number;
      space_id: string | null;
    };
    const peerMap = new Map<string, Peer>();
    for (const m of msgs ?? []) {
      const peer = normPhone(m.from_number);
      if (!peer) continue;
      const key = `${m.connection_id}:${peer}`;
      const existing = peerMap.get(key);
      if (!existing) {
        peerMap.set(key, {
          connection_id: m.connection_id,
          peer,
          name: m.from_name ?? null,
          last: m.timestamp,
          count: 1,
          space_id: m.space_id ?? null,
        });
      } else {
        existing.count += 1;
        if (m.timestamp > existing.last) existing.last = m.timestamp;
        if (!existing.name && m.from_name) existing.name = m.from_name;
        if (!existing.space_id && m.space_id) existing.space_id = m.space_id;
      }
    }
    const peers = Array.from(peerMap.values()).sort((a, b) =>
      a.last < b.last ? 1 : -1,
    );

    return {
      spaces: spaces.map((s) => ({
        id: s.id,
        name: s.name,
        wa_group_name: s.wa_group_name,
        whatsapp_phone_number: s.whatsapp_phone_number,
        whatsapp_group_id: s.whatsapp_group_id,
      })),
      connections: connections ?? [],
      groups: groups ?? [],
      peers,
    };
  });

/**
 * Link a Hub space to a WA Business thread (group or 1:1 peer).
 * - "group" target: sets collab_spaces.whatsapp_group_id, and wa_groups.space_id,
 *    then back-fills wa_messages.space_id for that group.
 * - "peer" target: sets collab_spaces.whatsapp_phone_number, and back-fills
 *    wa_messages.space_id for that connection+peer.
 */
export const linkSpaceToWa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("group"),
          space_id: z.string().uuid(),
          connection_id: z.string().uuid(),
          wa_group_id: z.string().min(1).max(128),
        }),
        z.object({
          kind: z.literal("peer"),
          space_id: z.string().uuid(),
          connection_id: z.string().uuid(),
          peer_number: z.string().min(3).max(32),
        }),
      ])
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ownership check on space
    const { data: space, error: sErr } = await supabase
      .from("collab_spaces")
      .select("id,user_id")
      .eq("id", data.space_id)
      .single();
    if (sErr) throw new Error(sErr.message);
    if (space.user_id !== userId) throw new Error("Forbidden");

    if (data.kind === "group") {
      const { error: updSpaceErr } = await supabase
        .from("collab_spaces")
        .update({ whatsapp_group_id: data.wa_group_id })
        .eq("id", data.space_id);
      if (updSpaceErr) throw new Error(updSpaceErr.message);

      const { error: updGroupErr } = await supabase
        .from("wa_groups")
        .update({ space_id: data.space_id })
        .eq("connection_id", data.connection_id)
        .eq("wa_group_id", data.wa_group_id)
        .eq("user_id", userId);
      if (updGroupErr) throw new Error(updGroupErr.message);

      const { error: updMsgErr } = await supabase
        .from("wa_messages")
        .update({ space_id: data.space_id })
        .eq("connection_id", data.connection_id)
        .eq("group_id", data.wa_group_id)
        .eq("user_id", userId);
      if (updMsgErr) throw new Error(updMsgErr.message);

      return { ok: true };
    }

    // peer
    const peer = normPhone(data.peer_number);
    const { error: updSpaceErr } = await supabase
      .from("collab_spaces")
      .update({ whatsapp_phone_number: peer })
      .eq("id", data.space_id);
    if (updSpaceErr) throw new Error(updSpaceErr.message);

    const { error: updMsgErr } = await supabase
      .from("wa_messages")
      .update({ space_id: data.space_id })
      .eq("connection_id", data.connection_id)
      .eq("from_number", peer)
      .is("group_id", null)
      .eq("user_id", userId);
    if (updMsgErr) throw new Error(updMsgErr.message);

    return { ok: true };
  });

/** Unlink a Hub space from any WA Business thread. */
export const unlinkSpaceFromWa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ space_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: space, error: sErr } = await supabase
      .from("collab_spaces")
      .select("id,user_id,whatsapp_group_id")
      .eq("id", data.space_id)
      .single();
    if (sErr) throw new Error(sErr.message);
    if (space.user_id !== userId) throw new Error("Forbidden");

    await supabase
      .from("collab_spaces")
      .update({ whatsapp_phone_number: null, whatsapp_group_id: null })
      .eq("id", data.space_id);

    await supabase
      .from("wa_groups")
      .update({ space_id: null })
      .eq("space_id", data.space_id)
      .eq("user_id", userId);

    await supabase
      .from("wa_messages")
      .update({ space_id: null })
      .eq("space_id", data.space_id)
      .eq("user_id", userId);

    return { ok: true };
  });

/**
 * Auto-match Hub spaces with WA Business groups by fuzzy name comparison
 * (lowercased + non-alphanumeric stripped). Returns the proposals (does NOT apply).
 */
export const proposeWaAutoMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: spaces, error: sErr } = await supabase
      .from("collab_spaces")
      .select("id,name,wa_group_name,whatsapp_group_id")
      .eq("user_id", userId)
      .is("archived_at", null);
    if (sErr) throw new Error(sErr.message);

    const { data: groups, error: gErr } = await supabase
      .from("wa_groups")
      .select("wa_group_id,name,connection_id,space_id")
      .eq("user_id", userId);
    if (gErr) throw new Error(gErr.message);

    const norm = (s: string | null | undefined) =>
      (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

    type Proposal = {
      space_id: string;
      space_name: string;
      connection_id: string;
      wa_group_id: string;
      wa_group_name: string;
    };
    const proposals: Proposal[] = [];
    for (const sp of spaces ?? []) {
      if (sp.whatsapp_group_id) continue;
      const candidates = [sp.wa_group_name, sp.name].filter(Boolean) as string[];
      const normedCands = candidates.map(norm).filter((v) => v.length >= 3);
      for (const g of groups ?? []) {
        if (g.space_id) continue;
        const ng = norm(g.name);
        if (!ng) continue;
        if (normedCands.some((nc) => nc === ng || nc.includes(ng) || ng.includes(nc))) {
          proposals.push({
            space_id: sp.id,
            space_name: sp.name,
            connection_id: g.connection_id,
            wa_group_id: g.wa_group_id,
            wa_group_name: g.name,
          });
          break;
        }
      }
    }
    return proposals;
  });
