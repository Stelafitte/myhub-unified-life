import { useEffect, useState } from "react";
import { Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// On enregistre les sources contacts dans la table `accounts` avec un suffixe
// pour ne pas mélanger avec les comptes email. Cela évite toute migration.

type Source = "google_contacts" | "outlook_contacts" | "icloud_contacts";

type SourceRow = {
  id: string;
  name: string;
  type: string;
  credentials: Record<string, unknown> | null;
};

export function Step4Contacts({
  onContinue,
  onSkip,
  outlookPreconnected,
}: {
  onContinue: () => void;
  onSkip: () => void;
  outlookPreconnected: boolean;
}) {
  const { user } = useAuth();
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [contactCount, setContactCount] = useState<number>(0);
  const [mergeDuplicates, setMergeDuplicates] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Source | null>(null);

  const load = async () => {
    setLoading(true);
    const [a, c] = await Promise.all([
      supabase
        .from("accounts")
        .select("id,name,type,credentials")
        .in("type", ["gmail", "outlook", "icloud"]),
      supabase.from("contacts").select("*", { count: "exact", head: true }),
    ]);
    if (a.error) toast.error(a.error.message);
    else {
      // On filtre côté client les "comptes contacts" via un flag dans credentials
      const all = (a.data ?? []) as SourceRow[];
      setSources(
        all.filter((s) => {
          const c = s.credentials as { contacts_source?: boolean } | null;
          return c?.contacts_source === true;
        }),
      );
    }
    setContactCount(c.count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    if (user) void load();
  }, [user]);

  const isConnected = (s: Source) =>
    sources.some((r) => {
      const c = (r.credentials as { source_kind?: string } | null) ?? {};
      return c.source_kind === s;
    });

  const connect = async (source: Source) => {
    if (!user) return;
    setBusy(source);
    try {
      const label =
        source === "google_contacts" ? "Google Contacts" : source === "outlook_contacts" ? "Outlook Contacts" : "iCloud Contacts";
      const type = source === "icloud_contacts" ? "icloud" : source === "google_contacts" ? "gmail" : "outlook";
      const { error } = await supabase.from("accounts").insert({
        user_id: user.id,
        name: label,
        type,
        color: "#8b5cf6",
        icon: "👤",
        is_active: true,
        credentials: {
          contacts_source: true,
          source_kind: source,
          sync_direction: "bidirectional",
          merge_duplicates: mergeDuplicates,
        },
      });
      if (error) throw error;
      toast.success(`${label} ajouté`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const updateDirection = async (id: string, direction: string) => {
    const src = sources.find((s) => s.id === id);
    if (!src) return;
    const newCreds = { ...(src.credentials ?? {}), sync_direction: direction };
    const { error } = await supabase.from("accounts").update({ credentials: newCreds }).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Vos contacts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Importez vos contacts depuis Google, Outlook ou iCloud — fusion automatique optionnelle.
        </p>
      </div>

      {/* Sources connectées */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : sources.length > 0 ? (
        <div className="space-y-2">
          {sources.map((s) => {
            const dir = ((s.credentials as { sync_direction?: string } | null)?.sync_direction) ?? "bidirectional";
            return (
              <Card key={s.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">👤</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{contactCount} contact(s) dans MyHub</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Activé
                    </span>
                    <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="space-y-1.5 pl-12">
                    <Label className="text-xs">Direction</Label>
                    <Select value={dir} onValueChange={(v) => updateDirection(s.id, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bidirectional">↔ Bidirectionnel</SelectItem>
                        <SelectItem value="pull">← Lecture seule</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Boutons de connexion */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SourceButton
          icon="👤"
          label="Google Contacts"
          desc="OAuth2 Google"
          connected={isConnected("google_contacts")}
          loading={busy === "google_contacts"}
          onClick={() => connect("google_contacts")}
        />
        <SourceButton
          icon="👤"
          label="Outlook Contacts"
          desc="OAuth2 Microsoft"
          connected={isConnected("outlook_contacts")}
          highlighted={outlookPreconnected}
          loading={busy === "outlook_contacts"}
          onClick={() => connect("outlook_contacts")}
        />
        <SourceButton
          icon="👤"
          label="iCloud Contacts"
          desc="CardDAV"
          connected={isConnected("icloud_contacts")}
          loading={busy === "icloud_contacts"}
          onClick={() => connect("icloud_contacts")}
        />
      </div>

      {/* Toggle fusion */}
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="space-y-0.5">
          <Label htmlFor="merge" className="text-sm">
            Fusionner automatiquement les doublons évidents
          </Label>
          <p className="text-xs text-muted-foreground">
            Deux contacts avec la même adresse email seront fusionnés à la prochaine synchronisation.
          </p>
        </div>
        <Switch id="merge" checked={mergeDuplicates} onCheckedChange={setMergeDuplicates} />
      </div>

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

function SourceButton({
  icon,
  label,
  desc,
  connected,
  loading,
  highlighted,
  onClick,
}: {
  icon: string;
  label: string;
  desc: string;
  connected: boolean;
  loading?: boolean;
  highlighted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || connected}
      className={`flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-60 ${
        highlighted ? "border-primary/60 bg-primary/5" : "border-border"
      }`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
      {connected && <span className="mt-1 text-xs text-emerald-600">✓ Connecté</span>}
      {highlighted && !connected && (
        <span className="mt-1 text-xs text-primary">Pré-connecté depuis étape 2</span>
      )}
      {loading && <Loader2 className="mt-1 h-3 w-3 animate-spin" />}
    </button>
  );
}

// Garde l'icône Users importée pour usage futur
void Users;
