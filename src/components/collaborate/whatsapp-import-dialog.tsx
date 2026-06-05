import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importWhatsapp } from "@/lib/import-whatsapp.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  spaceName: string;
  onDone?: () => void;
}

interface ImportResult {
  ok: boolean;
  total_messages: number;
  imported: number;
  duplicates: number;
  actions_created: number;
  meetings_detected: number;
  decisions_found: number;
}

export function WhatsappImportDialog({ open, onOpenChange, spaceId, spaceName, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const importFn = useServerFn(importWhatsapp);

  const reset = () => {
    setFile(null);
    setBusy(false);
    setProgress(0);
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(15);
    try {
      const text = await file.text();
      setProgress(35);
      // Encode UTF-8 → base64
      const bytes = new TextEncoder().encode(text);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const content_b64 = btoa(bin);
      setProgress(55);

      const res = (await importFn({
        data: { space_id: spaceId, filename: file.name, content_b64 },
      })) as ImportResult;
      setProgress(100);
      setResult(res);
      toast.success(`Import terminé : ${res.imported} messages`);
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'import";
      toast.error(msg);
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>📱 Importer l'historique WhatsApp</DialogTitle>
          <DialogDescription>
            Importez un export <code>.txt</code> WhatsApp dans l'espace « {spaceName} ».
            L'IA détecte les actions, réunions et décisions.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-2">Fichier d'export</label>
              <Input
                type="file"
                accept=".txt,text/plain"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground mt-1">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
            {busy && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Import et analyse IA en cours…
                </p>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Import terminé</span>
            </div>
            <ul className="text-sm space-y-1 bg-muted/50 rounded-md p-3">
              <li>📨 {result.total_messages} messages détectés</li>
              <li>✅ {result.imported} importés ({result.duplicates} doublons ignorés)</li>
              <li>✓ {result.actions_created} actions proposées</li>
              <li>📅 {result.meetings_detected} réunions proposées</li>
              <li>🎯 {result.decisions_found} décisions identifiées</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Les actions et réunions sont créées avec le tag <code>proposition-whatsapp</code>.
              Vérifiez-les dans Tâches / Agenda.
            </p>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Annuler
              </Button>
              <Button onClick={handleSubmit} disabled={!file || busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Import…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Lancer l'import
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Fermer</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
