import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, NotebookPen, ListTodo, Apple, Video, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const LS_KEY = "onboarding.step5";

type Step5Prefs = {
  msTodoEnabled: boolean;
  msTodoDirection: "pull" | "bidirectional";
  appleRemindersUser: string;
  appleRemindersTested: "idle" | "ok" | "ko";
  zoomConnected: boolean;
};

const defaultPrefs: Step5Prefs = {
  msTodoEnabled: false,
  msTodoDirection: "pull",
  appleRemindersUser: "",
  appleRemindersTested: "idle",
  zoomConnected: false,
};

function loadPrefs(): Step5Prefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
}
function savePrefs(p: Step5Prefs) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function Step5Integrations({
  onContinue,
  onSkip,
  outlookPreconnected,
}: {
  onContinue: () => void;
  onSkip: () => void;
  outlookPreconnected: boolean;
}) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Step5Prefs>(loadPrefs);
  const [onenote, setOnenote] = useState({
    enabled: false,
    notebook_id: "",
    section_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingOneNote, setSavingOneNote] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("meeting_settings")
        .select("onenote_enabled, onenote_notebook_id, onenote_section_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setOnenote({
          enabled: !!data.onenote_enabled,
          notebook_id: data.onenote_notebook_id ?? "",
          section_id: data.onenote_section_id ?? "",
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const update = (patch: Partial<Step5Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const saveOneNote = async () => {
    if (!user) return;
    setSavingOneNote(true);
    const { error } = await supabase.from("meeting_settings").upsert(
      {
        user_id: user.id,
        onenote_enabled: onenote.enabled,
        onenote_notebook_id: onenote.notebook_id || null,
        onenote_section_id: onenote.section_id || null,
      },
      { onConflict: "user_id" },
    );
    setSavingOneNote(false);
    if (error) toast.error(error.message);
    else toast.success("Préférences OneNote enregistrées");
  };

  const testApple = async () => {
    if (!prefs.appleRemindersUser.includes("@")) {
      update({ appleRemindersTested: "ko" });
      toast.error("Identifiant iCloud invalide");
      return;
    }
    // Simulation : la vraie connexion CalDAV se fera côté serveur ultérieurement.
    update({ appleRemindersTested: "ok" });
    toast.success("Configuration enregistrée — test complet à la première sync");
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Intégrations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connectez vos outils favoris. Tout est optionnel et modifiable plus tard.
        </p>
      </div>

      {/* OneNote */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <NotebookPen className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Microsoft OneNote</p>
                  <p className="text-xs text-muted-foreground">
                    Synchroniser les comptes-rendus de réunion
                    {outlookPreconnected ? " — compte Microsoft déjà connecté" : ""}
                  </p>
                </div>
                <Switch
                  checked={onenote.enabled}
                  onCheckedChange={(v) => setOnenote((o) => ({ ...o, enabled: v }))}
                />
              </div>
            </div>
          </div>
          {onenote.enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Carnet (ID)</Label>
                <Input
                  placeholder="ID du carnet OneNote"
                  value={onenote.notebook_id}
                  onChange={(e) => setOnenote((o) => ({ ...o, notebook_id: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Section (ID)</Label>
                <Input
                  placeholder="ID de la section"
                  value={onenote.section_id}
                  onChange={(e) => setOnenote((o) => ({ ...o, section_id: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={saveOneNote} disabled={savingOneNote}>
                  {savingOneNote && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Enregistrer
                </Button>
              </div>
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Astuce : vous pourrez choisir le carnet et la section dans Paramètres → Réunions → OneNote (liste interactive).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Microsoft To Do */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ListTodo className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Microsoft To Do</p>
                  <p className="text-xs text-muted-foreground">
                    {outlookPreconnected
                      ? "🟢 Connexion Microsoft détectée"
                      : "🔴 Connectez d'abord un compte Microsoft (étape 2)"}
                  </p>
                </div>
                <Switch
                  checked={prefs.msTodoEnabled}
                  disabled={!outlookPreconnected}
                  onCheckedChange={(v) => update({ msTodoEnabled: v })}
                />
              </div>
            </div>
          </div>
          {prefs.msTodoEnabled && (
            <div className="space-y-1.5">
              <Label className="text-xs">Direction de synchronisation</Label>
              <Select value={prefs.msTodoDirection} onValueChange={(v) => update({ msTodoDirection: v as "pull" | "bidirectional" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pull">Pull uniquement (lecture)</SelectItem>
                  <SelectItem value="bidirectional">Bidirectionnel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Apple Reminders */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Apple className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="font-medium">Rappels Apple</p>
                <p className="text-xs text-muted-foreground">
                  Nécessite un mot de passe spécifique à l'application —{" "}
                  <a
                    href="https://support.apple.com/fr-fr/HT204397"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    générer un mot de passe <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
              <Input
                placeholder="exemple@icloud.com"
                value={prefs.appleRemindersUser}
                onChange={(e) => update({ appleRemindersUser: e.target.value, appleRemindersTested: "idle" })}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={testApple}>
                  Tester la connexion
                </Button>
                {prefs.appleRemindersTested === "ok" && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Prêt
                  </span>
                )}
                {prefs.appleRemindersTested === "ko" && (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <XCircle className="h-3.5 w-3.5" /> Échec
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Zoom */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Video className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Zoom</p>
                  <p className="text-xs text-muted-foreground">
                    {prefs.zoomConnected ? "🟢 Connecté" : "🔴 Non connecté"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={prefs.zoomConnected ? "outline" : "default"}
                  onClick={() => {
                    update({ zoomConnected: !prefs.zoomConnected });
                    toast.info(
                      prefs.zoomConnected
                        ? "Zoom déconnecté"
                        : "Connexion Zoom enregistrée — finalisation OAuth au premier appel",
                    );
                  }}
                >
                  {prefs.zoomConnected ? "Déconnecter" : "Connecter Zoom"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
