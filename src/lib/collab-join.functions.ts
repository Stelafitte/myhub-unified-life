import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Public — Récupère les infos d'affichage d'un projet à partir de son join_token. */
export const getSpaceByJoinToken = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(8).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("collab_spaces")
      .select("id,name,description,icon,color,join_enabled")
      .eq("join_token", data.token)
      .maybeSingle();
    if (!row || !row.join_enabled) return { space: null as null };
    return {
      space: {
        id: row.id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        icon: (row.icon as string | null) ?? null,
        color: (row.color as string | null) ?? null,
      },
    };
  });

/** Public — Soumet une demande d'adhésion et notifie le propriétaire. */
export const submitJoinRequest = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(8).max(128),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        email: z.string().trim().email().max(255),
        appOrigin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: space } = await supabaseAdmin
      .from("collab_spaces")
      .select("id,name,user_id,join_enabled")
      .eq("join_token", data.token)
      .maybeSingle();
    if (!space || !space.join_enabled) {
      return { success: false, reason: "invalid_or_disabled" as const };
    }
    const email = data.email.toLowerCase();

    // Dédup : refuse si une demande pending existe déjà pour cet email
    const { data: existing } = await supabaseAdmin
      .from("collab_join_requests")
      .select("id,status")
      .eq("space_id", space.id)
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.status === "pending") {
      return { success: true, alreadyPending: true };
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("collab_join_requests")
      .insert({
        space_id: space.id as string,
        first_name: data.firstName,
        last_name: data.lastName,
        email,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) return { success: false, reason: "insert_failed" as const };

    // Notifier le propriétaire
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email,display_name,first_name")
      .eq("id", space.user_id as string)
      .maybeSingle();
    if (profile?.email) {
      const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
      const reviewUrl = `${origin}/collaborate/space/${space.id}`;
      const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
      await sendTransactionalEmailServer({
        templateName: "space-join-request",
        recipientEmail: profile.email,
        idempotencyKey: `join-request-${inserted.id}`,
        templateData: {
          ownerName: profile.display_name || profile.first_name || "Bonjour",
          applicantName: `${data.firstName} ${data.lastName}`,
          applicantEmail: email,
          spaceName: space.name,
          reviewUrl,
        },
      });
    }
    return { success: true, alreadyPending: false };
  });

/** Owner — Active/désactive le lien public d'adhésion (peut régénérer le token). */
export const toggleJoinLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        enabled: z.boolean(),
        regenerate: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let newToken: string | null = null;
    if (data.regenerate) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      newToken = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    const update = newToken
      ? { join_enabled: data.enabled, join_token: newToken }
      : { join_enabled: data.enabled };
    const { data: row, error } = await supabase
      .from("collab_spaces")
      .update(update)
      .eq("id", data.spaceId)
      .eq("user_id", userId)
      .select("join_token,join_enabled")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Projet introuvable");
    return { joinToken: row.join_token as string | null, joinEnabled: !!row.join_enabled };
  });

/** Owner — Récupère l'état du lien d'adhésion. */
export const getJoinLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("collab_spaces")
      .select("join_token,join_enabled")
      .eq("id", data.spaceId)
      .eq("user_id", userId)
      .maybeSingle();
    return {
      joinToken: (row?.join_token as string | null) ?? null,
      joinEnabled: !!row?.join_enabled,
    };
  });

/** Owner — Liste les demandes d'adhésion (par défaut : pending). */
export const listJoinRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        spaceId: z.string().uuid(),
        status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("collab_join_requests")
      .select("id,first_name,last_name,email,status,created_at,reviewed_at,guest_id")
      .eq("space_id", data.spaceId)
      .order("created_at", { ascending: false });
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { requests: rows ?? [] };
  });

/** Owner — Approuve ou refuse une demande. Si approuvée, crée un invité et envoie l'email d'accès. */
export const reviewJoinRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        requestId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        appOrigin: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error: reqErr } = await supabase
      .from("collab_join_requests")
      .select("id,space_id,first_name,last_name,email,status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqErr || !req) throw new Error("Demande introuvable");
    if (req.status !== "pending") {
      return { success: false, reason: "already_reviewed" as const };
    }

    if (data.decision === "reject") {
      await supabase
        .from("collab_join_requests")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: userId })
        .eq("id", req.id);
      return { success: true, decision: "reject" as const };
    }

    // Approve : récupérer le projet (la RLS vérifie déjà que le user est owner du space)
    const { data: space, error: spErr } = await supabase
      .from("collab_spaces")
      .select("id,name,description,public_token,is_public,user_id")
      .eq("id", req.space_id as string)
      .maybeSingle();
    if (spErr || !space) throw new Error("Projet introuvable");
    if (space.user_id !== userId) throw new Error("Non autorisé");

    // S'assurer que le projet est public (pour avoir un public_token et permettre l'accès du guest)
    if (!space.is_public) {
      await supabase
        .from("collab_spaces")
        .update({ is_public: true })
        .eq("id", space.id as string);
    }
    const { data: spaceFinal } = await supabase
      .from("collab_spaces")
      .select("public_token")
      .eq("id", space.id as string)
      .maybeSingle();
    const publicToken = spaceFinal?.public_token as string | null;
    if (!publicToken) throw new Error("Token public manquant");

    const fullName = `${req.first_name} ${req.last_name}`.trim();
    const { data: guest, error: gErr } = await supabase
      .from("collab_guests")
      .insert({
        space_id: space.id as string,
        user_id: userId,
        name: fullName,
        email: req.email as string,
        role: "viewer",
        status: "active",
      })
      .select("id,access_token")
      .single();
    if (gErr || !guest) throw new Error(gErr?.message ?? "Création invité échouée");

    await supabase
      .from("collab_join_requests")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        guest_id: guest.id as string,
      })
      .eq("id", req.id);

    // Email d'accès
    const origin = data.appOrigin?.replace(/\/$/, "") ?? "";
    const accessUrl = `${origin}/space/${publicToken}?g=${guest.access_token}`;
    const { sendTransactionalEmailServer } = await import("@/lib/email/send.server");
    const result = await sendTransactionalEmailServer({
      templateName: "space-join-approved",
      recipientEmail: req.email as string,
      idempotencyKey: `join-approved-${req.id}`,
      templateData: {
        applicantName: req.first_name,
        spaceName: space.name,
        spaceDescription: space.description,
        accessUrl,
      },
    });
    return {
      success: true,
      decision: "approve" as const,
      emailSent: result.success,
      emailReason: result.reason,
    };
  });
