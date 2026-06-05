import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { Archive, Database, Loader2, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { downloadAsBlob, removeFromStorage, type DocumentRow } from "@/lib/documents";
import { confirmDialog } from "@/lib/confirm-dialog";

type RetentionRow = {
  user_id: string;
  email_retention_days: number;
  task_retention_days: number;
  meeting_retention_days: number;
  manual_retention_days: number;
  max_file_size_mb: number;
};

const STORAGE_QUOTA_MB = 1024; // 1 GB par défaut (indicatif)

function bytesToMB(b: number): number {
  return Math.round((b / (1024 * 1024)) * 10) / 10;
}

export function DocumentsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<RetentionRow | null>(null);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [busy, setBusy] = useState<"dupes" | "zip" | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setLoading(false); return; }

    const [{ data: ret }, { data: rows }] = await Promise.all([
      supabase.from("document_retention_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("documents").select("*").eq("user_id", userId),
    ]);

    setSettings(
      ret ?? {
        user_id: userId,
        email_retention_days: 365,
        task_retention_days: 730,
        meeting_retention_days: 730,
        manual_retention_days: 0,
        max_file_size_mb: 25,
      },
    );
    setDocs((rows ?? []) as DocumentRow[]);
    setLoading(false);
  }

  const usedBytes = useMemo(() => docs.reduce((s, d) => s + (d.file_size || 0), 0), [docs]);
  const usedMB = bytesToMB(usedBytes);
  const usedPct = Math.min(100, (usedMB / STORAGE_QUOTA_MB) * 100);

  const duplicates = useMemo(() => {
    const groups = new Map<string, DocumentRow[]>();
    for (const d of docs) {
      if (!d.checksum) continue;
      const arr = groups.get(d.checksum) ?? [];
      arr.push(d);
      groups.set(d.checksum, arr);
    }
    return Array.from(groups.values()).filter((g) => g.length > 1);
  }, [docs]);

  const dupeCount = duplicates.reduce((s, g) => s + (g.length - 1), 0);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("document_retention_settings")
      .upsert({ ...settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error("Erreur lors de l'enregistrement"); return; }
    toast.success("Paramètres enregistrés");
  }

  async function removeDuplicates() {
    if (dupeCount === 0) return;
    if (!await confirmDialog(`Supprimer ${dupeCount} doublon(s) ? Le premier exemplaire de chaque fichier est conservé.`)) return;
    setBusy("dupes");
    try {
      const toDelete: DocumentRow[] = [];
      for (const group of duplicates) {
        const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
        toDelete.push(...sorted.slice(1));
      }
      const paths = toDelete.map((d) => d.storage_path).filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("documents").remove(paths);
      }
      const ids = toDelete.map((d) => d.id);
      const { error } = await supabase.from("documents").delete().in("id", ids);
      if (error) throw error;
      toast.success(`${toDelete.length} doublon(s) supprimé(s)`);
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Échec de la suppression des doublons");
    } finally {
      setBusy(null);
    }
  }

  async function exportZip() {
    if (docs.length === 0) { toast.info("Aucun document à exporter"); return; }
    setBusy("zip");
    try {
      const zip = new JSZip();
      const folders: Record<string, JSZip> = {
        email: zip.folder("emails") ?? zip,
        task: zip.folder("taches") ?? zip,
        meeting: zip.folder("reunions") ?? zip,
        manual: zip.folder("manuels") ?? zip,
      };

      const manifest: Array<Record<string, unknown>> = [];
      let exported = 0;
      let failed = 0;

      for (const d of docs) {
        manifest.push({
          id: d.id,
          filename: d.original_filename,
          source: d.source_type,
          size: d.file_size,
          mime: d.mime_type,
          tags: d.tags,
          is_sensitive: d.is_sensitive,
          local_only: d.local_only,
          created_at: d.created_at,
        });
        if (!d.storage_path || d.local_only) continue;
        try {
          const blob = await downloadAsBlob(d.storage_path);
          const folder = folders[d.source_type] ?? zip;
          folder.file(`${d.id.slice(0, 8)}-${d.original_filename}`, blob);
          exported++;
        } catch (e) {
          console.error("[zip] download failed", d.storage_path, e);
          failed++;
        }
      }

      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myhubpro-documents-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Export RGPD prêt — ${exported} fichier(s)${failed ? `, ${failed} échec(s)` : ""}`);
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'export ZIP");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> Quota & utilisation</CardTitle>
          <CardDescription>Estimation cumulée des documents stockés dans le cloud (hors fichiers sensibles locaux).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{usedMB} Mo</span>
            <span className="text-muted-foreground">sur {STORAGE_QUOTA_MB} Mo</span>
          </div>
          <Progress value={usedPct} />
          <p className="text-xs text-muted-foreground">{docs.length} document(s) au total · {duplicates.length} groupe(s) de doublons</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rétention automatique</CardTitle>
          <CardDescription>Durée de conservation par source (0 = jamais d'archivage automatique).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Emails (jours)" value={settings.email_retention_days}
              onChange={(v) => setSettings({ ...settings, email_retention_days: v })} />
            <Field label="Tâches (jours)" value={settings.task_retention_days}
              onChange={(v) => setSettings({ ...settings, task_retention_days: v })} />
            <Field label="Réunions (jours)" value={settings.meeting_retention_days}
              onChange={(v) => setSettings({ ...settings, meeting_retention_days: v })} />
            <Field label="Uploads manuels (jours)" value={settings.manual_retention_days}
              onChange={(v) => setSettings({ ...settings, manual_retention_days: v })} />
          </div>
          <Separator />
          <Field label="Taille maximale par fichier (Mo)" value={settings.max_file_size_mb}
            onChange={(v) => setSettings({ ...settings, max_file_size_mb: v })} />
          <Button onClick={saveSettings} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
          <CardDescription>Nettoyage et export RGPD de l'ensemble de vos documents.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" onClick={removeDuplicates} disabled={busy !== null || dupeCount === 0}>
            {busy === "dupes" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Supprimer les doublons ({dupeCount})
          </Button>
          <Button variant="outline" onClick={exportZip} disabled={busy !== null}>
            {busy === "zip" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
            Export ZIP (RGPD)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}
