import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  institution: z.string().trim().max(255).optional().or(z.literal("")),
  specialty: z.string().trim().max(255).optional().or(z.literal("")),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  // honeypot
  website: z.string().max(0).optional().or(z.literal("")),
});

export const Route = createFileRoute("/api/public/landing-request")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => {
        try {
          const json = await request.json().catch(() => null);
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            return Response.json(
              { ok: false, error: "Données invalides" },
              { status: 400 },
            );
          }
          if (parsed.data.website && parsed.data.website.length > 0) {
            // honeypot triggered: pretend success
            return Response.json({ ok: true });
          }

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const ip =
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            request.headers.get("x-real-ip") ??
            null;

          const { error } = await supabaseAdmin
            .from("landing_requests")
            .insert({
              first_name: parsed.data.first_name,
              last_name: parsed.data.last_name,
              email: parsed.data.email,
              institution: parsed.data.institution || null,
              specialty: parsed.data.specialty || null,
              message: parsed.data.message || null,
              ip_address: ip,
              user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
            });

          if (error) {
            console.error("landing_requests insert failed:", error);
            return Response.json(
              { ok: false, error: "Enregistrement impossible" },
              { status: 500 },
            );
          }

          return Response.json({ ok: true });
        } catch (e) {
          console.error("landing-request handler error:", e);
          return Response.json(
            { ok: false, error: "Erreur serveur" },
            { status: 500 },
          );
        }
      },
    },
  },
});
