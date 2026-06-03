import { useEffect, useState } from "react";
import { Plug, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type IntegPrefs = {
  onenoteNotebook: string;
  onenoteSection: string;
  todoDirection: "read" | "bidirectional";
};

const DEFAULT: IntegPrefs = {
  onenoteNotebook: "",
  onenoteSection: "",
  todoDirection: "bidirectional",
};

export function IntegrationsSection() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<IntegPrefs>(DEFAULT);
  const [onenote, setOnenote] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("myhub-integrations");
    if (raw) {
      try {
        setPrefs({ ...DEFAULT, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("meeting_settings")
      .select("onenote_enabled, onenote_notebook_id, onenote_section_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setOnenote(!!data.onenote_enabled);
          setPrefs((p) => ({
            ...p,
            onenoteNotebook: data.onenote_notebook_id ?? p.onenoteNotebook,
            onenoteSection: data.onenote_section_id ?? p.onenoteSection,
          }));
        }
      });
  }, [user]);

  const update = (patch: Partial<IntegPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem("myhub-integrations", JSON.stringify(next));
  };

  const testConnection = (label: string, ok: boolean) => {
    if (ok) toast.success(`${label} : connexion OK`);
    else toast.error(`${label} : non connecté`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Intégrations</h2>
        <p className="text-sm text-muted-foreground">OneNote, Microsoft To Do, Apple Rappels, Zoom</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl">📓</div>
            <div className="flex-1">
              <CardTitle className="text-base">OneNote</CardTitle>
              <p className="text-xs text-muted-foreground">Notes de réunion automatiques</p>
            </div>
            <StatusBadge connected={onenote} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Carnet par défaut</Label>
              <Input
                value={prefs.onenoteNotebook}
                onChange={(e) => update({ onenoteNotebook: e.target.value })}
                placeholder="ID du carnet"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Section par défaut</Label>
              <Input
                value={prefs.onenoteSection}
                onChange={(e) => update({ onenoteSection: e.target.value })}
                placeholder="ID de la section"
              />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => testConnection("OneNote", onenote)}>
            Tester la connexion
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl">✅</div>
            <div className="flex-1">
              <CardTitle className="text-base">Microsoft To Do</CardTitle>
              <p className="text-xs text-muted-foreground">Synchronisation des tâches</p>
            </div>
            <StatusBadge connected={false} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Direction :</span>
            <Select
              value={prefs.todoDirection}
              onValueChange={(v) => update({ todoDirection: v as IntegPrefs["todoDirection"] })}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Lecture seule</SelectItem>
                <SelectItem value="bidirectional">Bidirectionnel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={() => testConnection("Microsoft To Do", false)}>
            Tester la connexion
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🍎</div>
            <div className="flex-1">
              <CardTitle className="text-base">Rappels Apple</CardTitle>
              <p className="text-xs text-muted-foreground">Via iCloud CalDAV</p>
            </div>
            <StatusBadge connected={false} />
          </div>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => testConnection("Rappels Apple", false)}>
            Tester la connexion
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🎥</div>
            <div className="flex-1">
              <CardTitle className="text-base">Zoom</CardTitle>
              <p className="text-xs text-muted-foreground">Création automatique de liens</p>
            </div>
            <StatusBadge connected={zoom} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => testConnection("Zoom", zoom)}>
            Tester la connexion
          </Button>
          {zoom ? (
            <Button size="sm" variant="ghost" onClick={() => { setZoom(false); toast.success("Zoom déconnecté"); }}>
              Déconnecter
            </Button>
          ) : (
            <Button size="sm" onClick={() => toast.info("OAuth Zoom bientôt disponible")}>
              <Plug className="mr-2 h-4 w-4" /> Connecter
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1">
      <CheckCircle2 className="h-3 w-3" /> Connecté
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <XCircle className="h-3 w-3" /> Non connecté
    </Badge>
  );
}
