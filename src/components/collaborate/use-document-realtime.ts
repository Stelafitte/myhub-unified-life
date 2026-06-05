import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Options {
  documentId: string;
  enabled?: boolean;
  onDocumentUpdate?: () => void;
  onCommentsChange?: () => void;
  onVersionsChange?: () => void;
}

/**
 * Subscribes to realtime changes for a given document:
 * - the document row itself (content/title/version_count)
 * - its comments
 * - its versions
 *
 * Callbacks are coalesced via micro-debouncing.
 */
export function useDocumentRealtime({
  documentId,
  enabled = true,
  onDocumentUpdate,
  onCommentsChange,
  onVersionsChange,
}: Options) {
  const docCb = useRef(onDocumentUpdate);
  const commentsCb = useRef(onCommentsChange);
  const versionsCb = useRef(onVersionsChange);
  useEffect(() => {
    docCb.current = onDocumentUpdate;
    commentsCb.current = onCommentsChange;
    versionsCb.current = onVersionsChange;
  });

  useEffect(() => {
    if (!enabled || !documentId) return;

    let docTimer: ReturnType<typeof setTimeout> | null = null;
    let cTimer: ReturnType<typeof setTimeout> | null = null;
    let vTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`collab-doc-${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "collab_documents",
          filter: `id=eq.${documentId}`,
        },
        () => {
          if (docTimer) clearTimeout(docTimer);
          docTimer = setTimeout(() => docCb.current?.(), 250);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "collab_document_comments",
          filter: `document_id=eq.${documentId}`,
        },
        () => {
          if (cTimer) clearTimeout(cTimer);
          cTimer = setTimeout(() => commentsCb.current?.(), 200);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "collab_document_versions",
          filter: `document_id=eq.${documentId}`,
        },
        () => {
          if (vTimer) clearTimeout(vTimer);
          vTimer = setTimeout(() => versionsCb.current?.(), 200);
        },
      )
      .subscribe();

    return () => {
      if (docTimer) clearTimeout(docTimer);
      if (cTimer) clearTimeout(cTimer);
      if (vTimer) clearTimeout(vTimer);
      supabase.removeChannel(channel);
    };
  }, [documentId, enabled]);
}
