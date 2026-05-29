import { useEffect, useState } from "react";
import { ShieldAlert, Plus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { toast } from "sonner";

type Level = "strict" | "normal" | "permissive";
type Action = "A" | "B" | "C";

type Settings = {
  sensitivity_level: Level;
  sensitive_action: Action;
  whitelist: string[];
  blacklist: string[];
};

const DEFAULTS: Settings = {
  sensitivity_level: "normal",
  sensitive_action: "C",
  whitelist: [],
  blacklist: [],
};

export function SecuritySection() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newWhite, setNewWhite] = useState("");
  const [newBlack, setNewBlack] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("security_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setSettings({
          sensitivity_level: (data.sensitivity_level as Level) ?? "normal",
          sensitive_action: (data.sensitive_action as Action) ?? "C",
          whitelist: data.whitelist ?? [],
          blacklist: data.blacklist ?? [],
        });
      }
      setLoading(false);
    })();
  }, [user?.id]);

  async function save(next: Settings) {
    if (!user?.id) return;
    setSaving(true);
    const { error } = await supabase
      .from("security_settings")
      .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error("Échec de l'enregistrement");
      return;
    }
    setSettings(next);
    toast.success("Paramètres enregistrés");
  }

  function addEntry(list: "whitelist" | "blacklist", value: string) {
    const v = value.trim().toLowerCase();
    if (!v) return;
    if (settings[list].includes(v)) {
      toast.info("Déjà présent");
      return;
    }
    save({ ...settings, [list]: [...settings[list], v] });
    if (list === "whitelist") setNewWhite("");
    else setNewBlack("");
  }

  function removeEntry(list: "whitelist" | "blacklist", value: string) {
    save({ ...settings, [list]: settings[list].filter((e) => e !== value) });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm text-foreground/80">
            <div className="font-medium text-foreground">Protection HDS / RGPD</div>
            <p className="mt-1 text-xs leading-relaxed">
              MyHub Pro détecte localement (sans appel API externe) les emails susceptibles
              de contenir des données de santé. Ces messages sont isolés du traitement IA
              et marqués d'un cadenas 🔒 dans votre boîte.
            </p>
          </div>
        </div>
      </div>

      {/* Sensibilité */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Sensibilité de détection</h3>
          <p className="text-xs text-muted-foreground">
            Plus le niveau est strict, plus de faux positifs mais aucun mail sensible ne passe.
          </p>
        </div>
        <RadioGroup
          value={settings.sensitivity_level}
          onValueChange={(v) => save({ ...settings, sensitivity_level: v as Level })}
          disabled={saving}
          className="grid gap-2"
        >
          {([
            ["strict", "Stricte", "Recommandé pour usage médical réel — moindre doute = quarantaine"],
            ["normal", "Normale", "Équilibre faux positifs / sécurité (par défaut)"],
            ["permissive", "Permissive", "Uniquement patterns évidents (NSS, NIP explicite)"],
          ] as const).map(([val, label, desc]) => (
            <Label
              key={val}
              htmlFor={`lvl-${val}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/50"
            >
              <RadioGroupItem value={val} id={`lvl-${val}`} className="mt-0.5" />
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </section>

      {/* Action */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Traitement des mails sensibles</h3>
          <p className="text-xs text-muted-foreground">
            Comportement appliqué dès qu'un mail est détecté comme contenant des données de santé.
          </p>
        </div>
        <RadioGroup
          value={settings.sensitive_action}
          onValueChange={(v) => save({ ...settings, sensitive_action: v as Action })}
          disabled={saving}
          className="grid gap-2"
        >
          {([
            ["A", "🔒 Quarantaine locale chiffrée", "Stocké uniquement sur cet appareil (IndexedDB AES-256). Jamais envoyé au cloud. Disponible en Phase 3."],
            ["B", "🚫 Blocage total", "Mail non téléchargé, laissé sur le webmail OVH. Disponible en Phase 4."],
            ["C", "⚠️ Alerte + décision manuelle", "Notification à chaque détection avec choix : stocker localement / supprimer / faux positif. (Par défaut)"],
          ] as const).map(([val, label, desc]) => (
            <Label
              key={val}
              htmlFor={`act-${val}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/50"
            >
              <RadioGroupItem value={val} id={`act-${val}`} className="mt-0.5" />
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </section>

      {/* Whitelist */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Liste blanche</h3>
          <p className="text-xs text-muted-foreground">
            Expéditeurs ou domaines de confiance — leurs mails ne sont jamais marqués sensibles.
            Exemples : <code className="rounded bg-muted px-1">contact@cabinet.fr</code> ou <code className="rounded bg-muted px-1">cabinet.fr</code>
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={newWhite}
            onChange={(e) => setNewWhite(e.target.value)}
            placeholder="email@domaine.fr ou domaine.fr"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEntry("whitelist", newWhite))}
          />
          <Button onClick={() => addEntry("whitelist", newWhite)} disabled={saving} size="sm">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ChipList items={settings.whitelist} onRemove={(v) => removeEntry("whitelist", v)} variant="white" />
      </section>

      {/* Blacklist */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Liste noire</h3>
          <p className="text-xs text-muted-foreground">
            Expéditeurs ou domaines toujours considérés comme sensibles, quel que soit le contenu.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={newBlack}
            onChange={(e) => setNewBlack(e.target.value)}
            placeholder="@chu-exemple.fr ou contact@hopital.fr"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEntry("blacklist", newBlack))}
          />
          <Button onClick={() => addEntry("blacklist", newBlack)} disabled={saving} size="sm">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ChipList items={settings.blacklist} onRemove={(v) => removeEntry("blacklist", v)} variant="black" />
      </section>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        ℹ️ Les nouveaux paramètres s'appliquent aux prochains emails synchronisés. Les mails
        déjà classés gardent leur statut tant qu'ils ne sont pas re-scannés.
      </p>
    </div>
  );
}

function ChipList({
  items,
  onRemove,
  variant,
}: {
  items: string[];
  onRemove: (v: string) => void;
  variant: "white" | "black";
}) {
  if (items.length === 0) {
    return <p className="text-xs italic text-muted-foreground">Aucune entrée.</p>;
  }
  const cls =
    variant === "white"
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : "bg-red-500/10 text-red-700 dark:text-red-400";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <span
          key={v}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${cls}`}
        >
          {v}
          <button
            onClick={() => onRemove(v)}
            className="rounded-full opacity-70 transition-opacity hover:opacity-100"
            aria-label={`Retirer ${v}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
