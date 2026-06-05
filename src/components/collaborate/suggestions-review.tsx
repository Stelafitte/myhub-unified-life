import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listWaSuggestions,
  approveWaSuggestion,
  rejectWaSuggestion,
  type WaSuggestion,
} from "@/lib/wa-suggestions.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2,
  Check,
  X,
  CheckSquare,
  Calendar,
  MessageSquareQuote,
} from "lucide-react";

const KIND_LABEL: Record<WaSuggestion["kind"], { label: string; icon: ReactNode }> = {
  action: { label: "Action", icon: <CheckSquare className="h-4 w-4" /> },
  meeting: { label: "Réunion", icon: <Calendar className="h-4 w-4" /> },
  decision: { label: "Décision", icon: <MessageSquareQuote className="h-4 w-4" /> },
};

export function SuggestionsReview() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [items, setItems] = useState<WaSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listFn = useServerFn(listWaSuggestions);
  const approveFn = useServerFn(approveWaSuggestion);
  const rejectFn = useServerFn(rejectWaSuggestion);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { status } });
      setItems(res.suggestions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const approve = async (s: WaSuggestion) => {
    setBusyId(s.id);
    try {
      await approveFn({ data: { id: s.id } });
      toast.success("Suggestion approuvée");
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (s: WaSuggestion) => {
    setBusyId(s.id);
    try {
      await rejectFn({ data: { id: s.id } });
      toast.success("Suggestion rejetée");
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
      <TabsList>
        <TabsTrigger value="pending">À valider</TabsTrigger>
        <TabsTrigger value="approved">Approuvées</TabsTrigger>
        <TabsTrigger value="rejected">Rejetées</TabsTrigger>
      </TabsList>

      <TabsContent value={status} className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Chargement…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Aucune suggestion {status === "pending" ? "à valider" : status === "approved" ? "approuvée" : "rejetée"}.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((s) => {
              const k = KIND_LABEL[s.kind];
              return (
                <Card key={s.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="secondary" className="gap-1">
                            {k.icon}
                            {k.label}
                          </Badge>
                          {s.space_name && (
                            <Badge variant="outline" className="text-xs">
                              {s.space_name}
                            </Badge>
                          )}
                          {s.priority && s.kind === "action" && (
                            <Badge
                              variant={s.priority === "urgent" ? "destructive" : "outline"}
                              className="text-xs"
                            >
                              {s.priority}
                            </Badge>
                          )}
                          {s.kind === "meeting" && s.meeting_start_at && (
                            <Badge variant="outline" className="text-xs">
                              {new Date(s.meeting_start_at).toLocaleString("fr-FR")}
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium">{s.title}</p>
                        {s.source_text && (
                          <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">
                            « {s.source_text} » — {s.source_sender ?? "?"}
                            {s.source_message_at &&
                              ` · ${new Date(s.source_message_at).toLocaleString("fr-FR")}`}
                          </p>
                        )}
                      </div>
                    </div>

                    {status === "pending" && (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reject(s)}
                          disabled={busyId === s.id}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Rejeter
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approve(s)}
                          disabled={
                            busyId === s.id ||
                            (s.kind === "meeting" && !s.meeting_start_at)
                          }
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Approuver
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
