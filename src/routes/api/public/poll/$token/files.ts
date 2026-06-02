import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/poll/$token/files")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || token.length > 128) {
          return new Response(JSON.stringify({ error: "Invalid token" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        // Resolve poll → meeting_id
        const { data: poll, error: pErr } = await supabaseAdmin
          .from("meeting_polls")
          .select("meeting_id")
          .eq("public_token", token)
          .maybeSingle();
        if (pErr || !poll) {
          return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // Get shared files for this meeting
        const { data: shared } = await supabaseAdmin
          .from("meeting_shared_files")
          .select("document_id")
          .eq("meeting_id", poll.meeting_id)
          .eq("share_with_externals", true);

        const ids = (shared ?? []).map((s) => s.document_id);
        if (ids.length === 0) {
          return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        const { data: docs } = await supabaseAdmin
          .from("documents")
          .select("id, filename, file_size, mime_type, storage_path, is_sensitive")
          .in("id", ids);

        const files: { id: string; filename: string; file_size: number; mime_type: string | null; url: string | null }[] = [];
        const expiresIn = 7 * 24 * 3600;
        for (const d of (docs ?? [])) {
          // Belt-and-suspenders: never expose sensitive docs even if mistakenly shared
          if (d.is_sensitive) continue;
          let url: string | null = null;
          if (d.storage_path) {
            const { data: signed } = await supabaseAdmin.storage.from("documents").createSignedUrl(d.storage_path, expiresIn);
            url = signed?.signedUrl ?? null;
          }
          files.push({
            id: d.id,
            filename: d.filename,
            file_size: d.file_size,
            mime_type: d.mime_type,
            url,
          });
        }

        return new Response(JSON.stringify({ files }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
