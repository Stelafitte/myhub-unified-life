import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, KeyRound, CheckCircle2, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import {
  getMyAiSettings,
  saveMyAiSettings,
  saveMyAiKey,
  deleteMyAiKey,
  getMyAiUsage,
  MODELS_BY_PROVIDER,
  type AiSettingsView,
} from "@/lib/api/ai-settings.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm-dialog";

const PROVIDER_LABEL: Record<string, string> = {
  lovable: "Lovable AI (par défaut, inclus)",
  openai: "OpenAI (votre compte)",
  anthropic: "Anthropic (votre compte)",
  google: "Google Gemini (votre compte)",
};

const KEY_HELP: Record<string, { url: string; placeholder: string; label: string }> = {
  openai: {
    url: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
    label: "OpenAI API key",
  },
  anthropic: {
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
    label: "Anthropic API key",
  },
  google: {
    url: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza...",
    label: "Google AI Studio API key",
  },
};

export function AiProvidersSection() {
  const getFn = useServerFn(getMyAiSettings);
  const saveFn = useServerFn(saveMyAiSettings);
  const saveKeyFn = useServerFn(saveMyAiKey);
  const delKeyFn = useServerFn(deleteMyAiKey);
  const usageFn = useServerFn(getMyAiUsage);

  const [s, setS] = useState<AiSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [usage, setUsage] = useState<{ total: number; ownKey: number; errors: number; byProvider: Record<string, number> } | null>(null);

  useEffect(() => {
    Promise.all([getFn(), usageFn()])
      .then(([settings, u]) => {
        setS(settings);
        setUsage(u);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erreur de chargement"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !s) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des préférences IA…
      </div>
    );
  }

  const update = async (patch: Partial<AiSettingsView>) => {
    const next = { ...s, ...patch };
    setS(next);
    setSaving(true);
    try {
      await saveFn({
        data: {
          provider: next.provider,
          model: next.model,
          use_own_key: next.use_own_key,
          feat_trash: next.feat_trash,
          feat_classify: next.feat_classify,
          feat_summary: next.feat_summary,
          feat_suggestions: next.feat_suggestions,
          feat_voice: next.feat_voice,
          feat_assistant: next.feat_assistant,
          trash_threshold: next.trash_threshold,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sauvegarde échouée");
    } finally {
      setSaving(false);
    }
  };

  const changeProvider = (p: AiSettingsView["provider"]) => {
    const models = MODELS_BY_PROVIDER[p] ?? [];
    const model = models[0]?.value ?? s.model;
    update({ provider: p, model, use_own_key: p !== "lovable" });
  };

  const saveKey = async () => {
    if (s.provider === "lovable") return;
    if (newKey.length < 10) {
      toast.error("Clé trop courte");
      return;
    }
    setSavingKey(true);
    try {
      const res = await saveKeyFn({
        data: { provider: s.provider as "openai" | "anthropic" | "google", api_key: newKey },
      });
      toast.success(`Clé enregistrée (•••• ${res.last4})`);
      setNewKey("");
      const fresh = await getFn();
      setS(fresh);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    if (!(await confirmDialog("Supprimer votre clé API personnelle et revenir à Lovable AI ?"))) return;
    try {
      await delKeyFn();
      const fresh = await getFn();
      setS(fresh);
      toast.success("Clé supprimée — retour à Lovable AI");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const models = MODELS_BY_PROVIDER[s.provider] ?? [];
  const needsKey = s.provider !== "lovable";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Fournisseur IA
            {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select value={s.provider} onValueChange={(v) => changeProvider(v as AiSettingsView["provider"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {s.provider === "lovable"
                ? "Utilise les crédits IA inclus. Aucun setup."
                : "Vos requêtes IA passeront par votre compte — vous êtes facturé directement par le fournisseur."}
            </p>
          </div>

          <div className="space-y-1">
            <Label>Modèle</Label>
            <Select value={s.model} onValueChange={(v) => update({ model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsKey && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  {KEY_HELP[s.provider]?.label}
                </Label>
                {s.has_key && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configurée (•••• {s.key_last4})
                  </span>
                )}
              </div>

              {!s.encryption_available && (
                <div className="flex items-start gap-2 text-xs rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 border border-amber-500/30">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Le chiffrement des clés API n'est pas encore configuré sur ce projet
                    (secret <code>AI_KEYS_ENCRYPTION_KEY</code> manquant). Vous pouvez
                    choisir le provider et le modèle dès maintenant ; la saisie de votre
                    clé sera possible une fois le secret ajouté.
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={s.has_key ? "Remplacer la clé existante…" : KEY_HELP[s.provider]?.placeholder}
                  disabled={!s.encryption_available || savingKey}
                />
                <Button onClick={saveKey} disabled={!s.encryption_available || savingKey || newKey.length < 10}>
                  {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vérifier & enregistrer"}
                </Button>
                {s.has_key && (
                  <Button variant="ghost" size="icon" onClick={removeKey} title="Supprimer la clé">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Obtenir une clé :{" "}
                <a href={KEY_HELP[s.provider]?.url} target="_blank" rel="noopener" className="underline">
                  {KEY_HELP[s.provider]?.url}
                </a>
              </p>
              <p className="text-[11px] text-muted-foreground">
                La clé est chiffrée AES-256-GCM côté serveur. Elle n'est jamais renvoyée au navigateur.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fonctions IA activées</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Pré-tri corbeille" value={s.feat_trash} onChange={(v) => update({ feat_trash: v })} />
          <Toggle label="Classification & priorisation" value={s.feat_classify} onChange={(v) => update({ feat_classify: v })} />
          <Toggle label="Résumés automatiques" value={s.feat_summary} onChange={(v) => update({ feat_summary: v })} />
          <Toggle label="Suggestions de réponse" value={s.feat_suggestions} onChange={(v) => update({ feat_suggestions: v })} />
          <Toggle label="Commandes vocales" value={s.feat_voice} onChange={(v) => update({ feat_voice: v })} />
          <Toggle label="Assistant IA global" value={s.feat_assistant} onChange={(v) => update({ feat_assistant: v })} />
          {s.feat_trash && (
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm">Seuil de confiance pré-tri</Label>
                <span className="text-sm font-medium tabular-nums">{s.trash_threshold}%</span>
              </div>
              <Slider
                min={50}
                max={95}
                step={5}
                value={[s.trash_threshold]}
                onValueChange={(v) => update({ trash_threshold: v[0] ?? 70 })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage IA (30 derniers jours)</CardTitle>
        </CardHeader>
        <CardContent>
          {!usage ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Appels IA" value={usage.total} />
                <Stat label="Via votre clé" value={usage.ownKey} />
                <Stat label="Erreurs" value={usage.errors} />
              </div>
              {Object.keys(usage.byProvider).length > 0 && (
                <div className="text-xs text-muted-foreground pt-1">
                  Par provider :{" "}
                  {Object.entries(usage.byProvider).map(([k, v]) => `${k} (${v})`).join(" · ")}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
