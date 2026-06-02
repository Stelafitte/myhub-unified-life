import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, ChevronRight } from "lucide-react";

type Sibling = {
  id: string;
  title: string;
  start_at: string;
  session_number: number | null;
  status: string;
};

export function MeetingHistorySection({
  meetingId,
  parentId,
  onOpen,
}: {
  meetingId: string;
  parentId: string | null;
  onOpen: (id: string) => void;
}) {
  const seriesRoot = parentId ?? meetingId;
  const [items, setItems] = useState<Sibling[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("meetings")
        .select("id,title,start_at,session_number,status")
        .or(`id.eq.${seriesRoot},recurrence_parent_id.eq.${seriesRoot}`)
        .order("start_at", { ascending: false });
      setItems((data ?? []) as Sibling[]);
      setLoading(false);
    })();
  }, [seriesRoot]);

  if (!loading && items.length <= 1) return null;

  return (
    <div className="rounded-md border bg-muted/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4" />
        <span className="text-sm font-medium">🕐 Historique de la série</span>
        <Badge variant="secondary" className="text-[10px]">
          {items.length} session{items.length > 1 ? "s" : ""}
        </Badge>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {items.map((s) => {
            const isCurrent = s.id === meetingId;
            const d = new Date(s.start_at);
            const past = d.getTime() < Date.now();
            return (
              <li key={s.id}>
                <Button
                  type="button"
                  variant={isCurrent ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start h-auto py-1.5"
                  disabled={isCurrent}
                  onClick={() => onOpen(s.id)}
                >
                  <span className="flex-1 text-left text-xs">
                    {s.session_number ? (
                      <Badge variant="outline" className="text-[10px] mr-2">
                        #{s.session_number}
                      </Badge>
                    ) : null}
                    {d.toLocaleDateString("fr-FR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    ·{" "}
                    {d.toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {past && !isCurrent && (
                      <span className="text-muted-foreground ml-1">(passée)</span>
                    )}
                    {isCurrent && (
                      <span className="text-primary ml-1">(en cours)</span>
                    )}
                  </span>
                  {!isCurrent && <ChevronRight className="h-3 w-3" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
