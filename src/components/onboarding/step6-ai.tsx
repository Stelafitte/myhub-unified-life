import { useState } from "react";
import { Sparkles, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";

const LS_KEY = "onboarding.step6";

type AiModel = "openai/gpt-4o-mini" | "anthropic/claude-haiku" | "anthropic/claude-sonnet";
type HdsLevel = "strict" | "normal" | "permissive";

type Step6Prefs = {
  useOwnKey: boolean;
  model: AiModel;
  apiKey: string;
  keyTested: "idle" | "ok" | "ko";
  features: {
    classify: boolean;
    summary: boolean;
    suggestTasks: boolean;
    semiAuto: boolean;
    detectEvents: boolean;
    archiveNewsletters: boolean;
    classifyDocs: boolean;
  };
  hdsLevel: HdsLevel;
};

const defaults: Step6Prefs = {
  useOwnKey: false,
  model: "openai/gpt-4o-mini",
  apiKey: "",
  keyTested: "idle",
  features: {
    classify: true,
    summary: true,
    suggestTasks: true,
    semiAuto: true,
    detectEvents: true,
    archiveNewsletters: true,
    classifyDocs: true,
  },
  hdsLevel: "normal",
};

function load(): Step6Prefs {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed, features: { ...defaults.features, ...(parsed.features ?? {}) } };
  } catch {
    return defaults;
  }
}
function save(p: Step6Prefs) {
  try {
    // On ne persiste pas la clé API en clair côté client si la valeur est vide ou si l'utilisateur n'opte pas
    const payload = p.useOwnKey ? p : { ...p, apiKey: "" };
    window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

const FEATURE_LABELS: Array<{ key: keyof Step6Prefs["features"]; label: string }> = [
  { key: "classify", label: "Classification emails (priorité + catégorie)" },
  { key: "summary", label: "Résumés emails" },
  { key: "suggestTasks", label: "Suggestions de tâches depuis les emails" },
  { key: "semiAuto", label: "Réponses semi-automatiques" },
  { key: "detectEvents", label: "Détection d'événements agenda dans les emails" },
  { key: "archiveNewsletters", label: "Archivage automatique des newsletters" },
  { key: "classifyDocs", label: "Classification et résumé des documents" },
];

const HDS_DESCRIPTIONS: Record<HdsLevel, string> = {
  strict: "Bloque dès le moindre doute (numéros sécu, dossiers patients, ordonnances).",
  normal: "Équilibre recommandé — détecte les données sensibles évidentes.",
  permissive: "Ne bloque que les contenus médicaux explicites.",
};

export function Step6AI({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const [prefs, setPrefs] = useState<Step6Prefs>(load);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);

  const update = (patch: Partial<Step6Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    save(next);
  };
  const toggleFeature = (k: keyof Step6Prefs["features"]) => {
    const next = { ...prefs, features: { ...prefs.features, [k]: !prefs.features[k] } };
    setPrefs(next);
    save(next);
  };

  const testKey = async () => {
    if (!prefs.apiKey.trim()) {
      update({ keyTested: "ko" });
      toast.error("Clé API vide");
      return;
    }
    setTesting(true);
    // Validation locale du format uniquement — la vraie validation passera par une server fn dédiée
    await new Promise((r) => setTimeout(r, 600));
    const looksOk =
      (prefs.model.startsWith("openai/") && prefs.apiKey.startsWith("sk-")) ||
      (prefs.model.startsWith("anthropic/") && prefs.apiKey.startsWith("sk-ant-"));
    setTesting(false);
    if (looksOk) {
      update({ keyTested: "ok" });
      toast.success("Format de clé valide — test complet à la première requête");
    } else {
      update({ keyTested: "ko" });
      toast.error("Format de clé inattendu pour ce fournisseur");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Intelligence artificielle</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choisissez le moteur IA et activez les automatisations que vous souhaitez.
        </p>
      </div>

      {/* IA incluse vs propre clé */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">IA incluse</p>
                  <Badge variant="secondary" className="text-[10px]">⚡ Inclus</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Modèle intégré MyHub Pro — aucune configuration requise.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="own-key" className="text-xs text-muted-foreground">
                Utiliser ma propre clé
              </Label>
              <Switch
                id="own-key"
                checked={prefs.useOwnKey}
                onCheckedChange={(v) => update({ useOwnKey: v, keyTested: "idle" })}
              />
            </div>
          </div>

          {prefs.useOwnKey && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fournisseur / modèle</Label>
                  <Select value={prefs.model} onValueChange={(v) => update({ model: v as AiModel, keyTested: "idle" })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</SelectItem>
                      <SelectItem value="anthropic/claude-haiku">Anthropic Claude Haiku</SelectItem>
                      <SelectItem value="anthropic/claude-sonnet">Anthropic Claude Sonnet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Clé API</Label>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={prefs.apiKey}
                      placeholder={prefs.model.startsWith("openai/") ? "sk-..." : "sk-ant-..."}
                      onChange={(e) => update({ apiKey: e.target.value, keyTested: "idle" })}
                      className="pr-9"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showKey ? "Masquer" : "Afficher"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={testKey} disabled={testing}>
                  {testing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Tester la clé
                </Button>
                {prefs.keyTested === "ok" && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Format valide
                  </span>
                )}
                {prefs.keyTested === "ko" && (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <XCircle className="h-3.5 w-3.5" /> Invalide
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                🔒 Vos données ne transitent pas par nos serveurs lorsque vous utilisez votre propre clé.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fonctionnalités IA */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-medium">Fonctionnalités IA</p>
          <div className="space-y-2">
            {FEATURE_LABELS.map((f) => (
              <label
                key={f.key}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm hover:bg-muted/50"
              >
                <span>{f.label}</span>
                <Switch checked={prefs.features[f.key]} onCheckedChange={() => toggleFeature(f.key)} />
              </label>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Détection données sensibles HDS
              </span>
              <Badge variant="secondary" className="text-[10px]">🔒 Toujours actif</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Niveau HDS */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <p className="text-sm font-medium">Niveau de sensibilité HDS</p>
            <p className="text-xs text-muted-foreground">Définit l'intensité de la détection des données de santé.</p>
          </div>
          <RadioGroup value={prefs.hdsLevel} onValueChange={(v) => update({ hdsLevel: v as HdsLevel })}>
            {(["strict", "normal", "permissive"] as HdsLevel[]).map((lvl) => (
              <label
                key={lvl}
                className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 hover:bg-muted/50"
              >
                <RadioGroupItem value={lvl} className="mt-1" />
                <div>
                  <p className="text-sm font-medium capitalize">
                    {lvl === "strict" ? "Stricte" : lvl === "normal" ? "Normale (recommandé)" : "Permissive"}
                  </p>
                  <p className="text-xs text-muted-foreground">{HDS_DESCRIPTIONS[lvl]}</p>
                </div>
              </label>
            ))}
          </RadioGroup>
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
