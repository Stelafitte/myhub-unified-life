import { useEffect, useState } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AiPromptsManager } from "./ai-prompts-manager";

type AiPrefs = {
  provider: "lovable-default" | "gpt-4o-mini" | "claude-haiku" | "claude-sonnet";
  useOwnKey: boolean;
  apiKey: string;
  summaries: boolean;
  classification: boolean;
  suggestions: boolean;
  hdsDetection: boolean;
  hdsLevel: "low" | "normal" | "high";
};

const DEFAULT: AiPrefs = {
  provider: "lovable-default",
  useOwnKey: false,
  apiKey: "",
  summaries: true,
  classification: true,
  suggestions: true,
  hdsDetection: true,
  hdsLevel: "normal",
};

export function AiSection() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AiPrefs>(DEFAULT);
  const [stats, setStats] = useState({ classified: 0, suggested: 0, replies: 0 });

  useEffect(() => {
    const raw = localStorage.getItem("myhub-ai-prefs");
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
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    Promise.all([
      supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("ai_processed_at", since),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("source_app", "myhubpro" as never)
        .gte("created_at", since),
      supabase
        .from("ai_feedback")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", since),
    ]).then(([a, b, c]) => {
      setStats({
        classified: a.count ?? 0,
        suggested: b.count ?? 0,
        replies: c.count ?? 0,
      });
    });
  }, [user]);

  const update = (patch: Partial<AiPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem("myhub-ai-prefs", JSON.stringify(next));
  };

  const resetLearned = async () => {
    if (!user) return;
    if (!confirm("Réinitialiser les préférences apprises (catégorisations corrigées, etc.) ?")) return;
    const { error } = await supabase.from("ai_feedback").delete().eq("user_id", user.id);
    if (error) toast.error("Échec de la réinitialisation");
    else toast.success("Préférences apprises réinitialisées");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Intelligence IA</h2>
        <p className="text-sm text-muted-foreground">Fournisseur, fonctionnalités et historique</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fournisseur</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Utiliser ma propre clé API</Label>
            <Switch checked={prefs.useOwnKey} onCheckedChange={(v) => update({ useOwnKey: v })} />
          </div>
          {prefs.useOwnKey && (
            <>
              <div className="space-y-1">
                <Label>Modèle</Label>
                <Select
                  value={prefs.provider}
                  onValueChange={(v) => update({ provider: v as AiPrefs["provider"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o-mini">OpenAI GPT-4o mini</SelectItem>
                    <SelectItem value="claude-haiku">Anthropic Claude Haiku</SelectItem>
                    <SelectItem value="claude-sonnet">Anthropic Claude Sonnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Clé API</Label>
                <Input
                  type="password"
                  value={prefs.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
            </>
          )}
          {!prefs.useOwnKey && (
            <p className="text-sm text-muted-foreground">
              <Sparkles className="inline h-4 w-4 mr-1" />
              Modèles Lovable AI utilisés par défaut (aucune clé requise).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fonctionnalités</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Résumés automatiques" value={prefs.summaries} onChange={(v) => update({ summaries: v })} />
          <Toggle label="Classification & priorisation" value={prefs.classification} onChange={(v) => update({ classification: v })} />
          <Toggle label="Suggestions de réponse" value={prefs.suggestions} onChange={(v) => update({ suggestions: v })} />
          <Toggle label="Détection HDS (données sensibles)" value={prefs.hdsDetection} onChange={(v) => update({ hdsDetection: v })} />
          {prefs.hdsDetection && (
            <div className="flex items-center justify-between pl-6">
              <Label className="text-sm text-muted-foreground">Niveau de sensibilité</Label>
              <Select
                value={prefs.hdsLevel}
                onValueChange={(v) => update({ hdsLevel: v as AiPrefs["hdsLevel"] })}
              >
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Faible</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Élevé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <AiPromptsManager />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique (30 derniers jours)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Emails classifiés" value={stats.classified} />
            <Stat label="Tâches suggérées" value={stats.suggested} />
            <Stat label="Retours utilisateur" value={stats.replies} />
          </div>
          <Button variant="outline" size="sm" className="mt-4" onClick={resetLearned}>
            <RotateCcw className="mr-2 h-4 w-4" /> Réinitialiser les préférences apprises
          </Button>
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
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
