import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getSpaceWaInfo,
  listSpaceWaImports,
  updateSpaceWaConfig,
  listSpaceWaTimeline,
} from "@/lib/collab.functions";
import {
  listWaSuggestions,
  approveWaSuggestion,
  rejectWaSuggestion,
  type WaSuggestion,
} from "@/lib/wa-suggestions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  Save,
  CheckSquare,
  Calendar,
  MessageSquareQuote,
  Check,
  X,
  FileText,
  Search,
  MessageCircle,
} from "lucide-react";
import { WhatsappImportDialog } from "./whatsapp-import-dialog";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  spaceId: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

const KIND_META: Record<WaSuggestion["kind"], { label: string; icon: React.ReactNode }> = {
  action: { label: "Action", icon: <CheckSquare className="h-3.5 w-3.5" /> },
  meeting: { label: "Réunion", icon: <Calendar className="h-3.5 w-3.5" /> },
  decision: { label: "Décision", icon: <MessageSquareQuote className="h-3.5 w-3.5" /> },
};

export function SpaceWhatsappTab({ spaceId }: Props) {
  const infoFn = useServerFn(getSpaceWaInfo);
  const importsFn = useServerFn(listSpaceWaImports);
  const updateFn = useServerFn(updateSpaceWaConfig);
  const suggestionsFn = useServerFn(listWaSuggestions);
  const approveFn = useServerFn(approveWaSuggestion);
  const rejectFn = useServerFn(rejectWaSuggestion);

  const [importOpen, setImportOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupExtId, setGroupExtId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const infoQ = useQuery({
    queryKey: ["space-wa-info", spaceId],
    queryFn: () => infoFn({ data: { spaceId } }),
  });
  const importsQ = useQuery({
    queryKey: ["space-wa-imports", spaceId],
    queryFn: () => importsFn({ data: { spaceId } }),
  });
  const sugQ = useQuery({
    queryKey: ["space-wa-suggestions", spaceId],
    queryFn: () => suggestionsFn({ data: { space_id: spaceId, status: "pending" } }),
  });

  useEffect(() => {
    if (infoQ.data?.space) {
      setGroupName(infoQ.data.space.wa_group_name ?? "");
      setPhone(infoQ.data.space.whatsapp_phone_number ?? "");
      setGroupExtId(infoQ.data.space.whatsapp_group_id ?? "");
    }
  }, [infoQ.data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          spaceId,
          wa_group_name: groupName,
          whatsapp_phone_number: phone,
          whatsapp_group_id: groupExtId,
        },
      });
      toast.success("Configuration enregistrée");
      infoQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (s: WaSuggestion) => {
    setBusyId(s.id);
    try {
      await approveFn({ data: { id: s.id } });
      toast.success("Suggestion approuvée");
      sugQ.refetch();
      infoQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (s: WaSuggestion) => {
    setBusyId(s.id);
    try {
      await rejectFn({ data: { id: s.id } });
      toast.success("Suggestion rejetée");
      sugQ.refetch();
      infoQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const spaceName = infoQ.data?.space?.name ?? "Espace";
  const pending = sugQ.data?.suggestions ?? [];
  const imports = importsQ.data?.imports ?? [];

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Configuration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            📱 Configuration WhatsApp
          </CardTitle>
          <Button onClick={() => setImportOpen(true)} size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Importer un export
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="wa-group-name" className="text-xs">
                Nom du groupe
              </Label>
              <Input
                id="wa-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Mon groupe WA"
              />
            </div>
            <div>
              <Label htmlFor="wa-phone" className="text-xs">
                Numéro de téléphone
              </Label>
              <Input
                id="wa-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+33 6 12 34 56 78"
              />
            </div>
            <div>
              <Label htmlFor="wa-group-id" className="text-xs">
                ID groupe (optionnel)
              </Label>
              <Input
                id="wa-group-id"
                value={groupExtId}
                onChange={(e) => setGroupExtId(e.target.value)}
                placeholder="120363xxxx@g.us"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm" variant="outline">
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Suggestions en attente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            ✨ Suggestions IA à valider
            {pending.length > 0 && (
              <Badge variant="secondary">{pending.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sugQ.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucune suggestion en attente.
            </p>
          ) : (
            <ul className="divide-y">
              {pending.map((s) => {
                const meta = KIND_META[s.kind];
                return (
                  <li key={s.id} className="py-3 flex gap-3">
                    <div className="mt-0.5 text-muted-foreground">{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {meta.label}
                        </Badge>
                        {s.priority && (
                          <Badge variant="secondary" className="text-xs">
                            {s.priority}
                          </Badge>
                        )}
                        {s.meeting_start_at && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(s.meeting_start_at), "PPp", { locale: fr })}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium mt-1">{s.title}</div>
                      {s.source_text && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                          « {s.source_text} » — {s.source_sender ?? "?"}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-emerald-600"
                        disabled={busyId === s.id}
                        onClick={() => handleApprove(s)}
                      >
                        {busyId === s.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-600"
                        disabled={busyId === s.id}
                        onClick={() => handleReject(s)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Historique imports */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Historique des imports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {importsQ.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : imports.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucun import pour cet espace.
            </p>
          ) : (
            <ul className="divide-y">
              {imports.map((imp) => (
                <li key={imp.id} className="py-2 flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0 truncate">{imp.filename}</div>
                  <span className="text-xs text-muted-foreground">
                    {imp.imported_messages ?? 0}/{imp.total_messages ?? 0} msg
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${STATUS_BADGE[imp.status] ?? ""}`}
                  >
                    {imp.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(imp.created_at), {
                      addSuffix: true,
                      locale: fr,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator className="opacity-0" />

      <WhatsappImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spaceId={spaceId}
        spaceName={spaceName}
        onDone={() => {
          importsQ.refetch();
          sugQ.refetch();
          infoQ.refetch();
        }}
      />
    </div>
  );
}
