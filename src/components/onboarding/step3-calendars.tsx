import { useEffect, useState } from "react";
import { Calendar, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { startGoogleCalendarOAuth } from "@/lib/api/google-calendar.functions";

type GCalConn = {
  id: string;
  label: string;
  google_email: string | null;
  sync_direction: string;
  is_active: boolean;
};

type Account = { id: string; name: string; type: string };

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export function Step3Calendars({
  onContinue,
  onSkip,
  outlookPreconnected,
}: {
  onContinue: () => void;
  onSkip: () => void;
  outlookPreconnected: boolean;
}) {
  const { user } = useAuth();
  const startGoogle = useServerFn(startGoogleCalendarOAuth);
  const [gcals, setGcals] = useState<GCalConn[]>([]);
  const [outlookAccounts, setOutlookAccounts] = useState<Account[]>([]);
  const [icloudOpen, setIcloudOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [g, a] = await Promise.all([
      supabase.from("google_calendar_connections").select("id,label,google_email,sync_direction,is_active"),
      supabase.from("accounts").select("id,name,type").eq("type", "outlook"),
    ]);
    if (g.error) toast.error(g.error.message);
    else setGcals((g.data ?? []) as GCalConn[]);
    if (!a.error) setOutlookAccounts((a.data ?? []) as Account[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) void load();
  }, [user]);

  const connectGoogle = async () => {
    setBusy(true);
    try {
      const res = await startGoogle({ data: { label: "Google Calendar" } });
      window.location.href = res.authorizationUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec OAuth Google");
      setBusy(false);
    }
  };

  const updateGcal = async (id: string, patch: Partial<GCalConn>) => {
    const { error } = await supabase.from("google_calendar_connections").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const removeGcal = async (id: string) => {
    const { error } = await supabase.from("google_calendar_connections").delete().eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Vos agendas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connectez Google, Outlook ou iCloud — vous pourrez tout synchroniser dans les deux sens.
        </p>
      </div>

      {/* Connexions existantes */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <>
          {gcals.map((g) => (
            <Card key={g.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-lg">📅</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{g.label}</p>
                    <p className="text-xs text-muted-foreground">{g.google_email}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connecté
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => removeGcal(g.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Direction de synchronisation</Label>
                  <Select value={g.sync_direction} onValueChange={(v) => updateGcal(g.id, { sync_direction: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bidirectional">↔ Bidirectionnel</SelectItem>
                      <SelectItem value="pull">← Lecture seule (Google → MyHub)</SelectItem>
                      <SelectItem value="push">→ Écriture seule (MyHub → Google)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* Boutons de connexion */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ProviderCard
          icon="📅"
          label="Google Calendar"
          desc="OAuth2 Google"
          status={gcals.length > 0 ? "connected" : "idle"}
          onClick={connectGoogle}
          loading={busy}
        />
        <ProviderCard
          icon="📅"
          label="Outlook Calendar"
          desc="OAuth2 Microsoft"
          status={outlookPreconnected || outlookAccounts.length > 0 ? "ready" : "idle"}
          onClick={() => toast.info("Calendrier Outlook : la sync utilise votre compte Outlook étape 2")}
          highlighted={outlookPreconnected}
        />
        <ProviderCard
          icon="📅"
          label="iCloud Calendar"
          desc="CalDAV"
          status="idle"
          onClick={() => setIcloudOpen(true)}
        />
      </div>

      {icloudOpen && (
        <IcloudCaldavForm
          onCancel={() => setIcloudOpen(false)}
          onSaved={() => {
            setIcloudOpen(false);
            toast.success("iCloud configuré");
            load();
          }}
        />
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onSkip}>
          Passer cette étape
        </Button>
        <Button onClick={onContinue} size="lg">
          Continuer
        </Button>
      </div>
    </div>
  );
}

function ProviderCard({
  icon,
  label,
  desc,
  status,
  onClick,
  loading,
  highlighted,
}: {
  icon: string;
  label: string;
  desc: string;
  status: "idle" | "ready" | "connected";
  onClick: () => void;
  loading?: boolean;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition hover:border-primary hover:bg-primary/5 ${
        highlighted ? "border-primary/60 bg-primary/5" : "border-border"
      } disabled:opacity-50`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
      {status === "connected" && (
        <span className="mt-1 text-xs text-emerald-600">✓ Connecté</span>
      )}
      {status === "ready" && (
        <span className="mt-1 text-xs text-primary">Pré-coché depuis étape 2</span>
      )}
      {loading && <Loader2 className="mt-1 h-3 w-3 animate-spin" />}
    </button>
  );
}

function IcloudCaldavForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!user || !email || !appPassword) {
      toast.error("Email et mot de passe d'application requis");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("accounts").insert({
      user_id: user.id,
      name: `iCloud Calendar (${email})`,
      type: "icloud",
      color: COLORS[0],
      icon: "📅",
      credentials: {
        caldav_server: "caldav.icloud.com",
        username: email,
        password: appPassword,
        email,
      },
      is_active: true,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else onSaved();
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <p className="font-medium">iCloud Calendar (CalDAV)</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Créez un mot de passe d'application sur{" "}
          <a
            href="https://appleid.apple.com"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            appleid.apple.com
          </a>
          .
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Apple ID (email)</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@icloud.com" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mot de passe d'application</Label>
            <Input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
