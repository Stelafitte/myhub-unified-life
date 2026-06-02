import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, NotebookPen, ExternalLink } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { syncMeetingToOneNote } from "@/lib/api/onenote.functions";
import { toast } from "sonner";

type Props = {
  meetingId: string;
  pageUrl?: string | null;
  onSynced?: (pageUrl: string | null) => void;
};

export function OneNoteSyncButton({ meetingId, pageUrl, onSynced }: Props) {
  const sync = useServerFn(syncMeetingToOneNote);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await sync({ data: { meetingId } });
      toast.success("Réunion synchronisée vers OneNote");
      onSynced?.(r.pageUrl ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec sync OneNote");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <NotebookPen className="mr-1 h-4 w-4" />
        )}
        {pageUrl ? "Mettre à jour OneNote" : "Envoyer vers OneNote"}
      </Button>
      {pageUrl && (
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Ouvrir <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
