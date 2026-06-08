import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { createTemplate } from "@/lib/expense.functions";

export function TemplateUploadDialog({
  open, onOpenChange, onCreated, userId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onCreated: () => void; userId: string;
}) {
  const createFn = useServerFn(createTemplate);
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name || !org || !file) { toast.error("Nom, organisation et fichier requis"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Fichier > 8 Mo"); return; }
    setLoading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${userId}/templates/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from("expense-receipts").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      await createFn({ data: { name, organization: org, file_path: path, mime_type: file.type || "application/octet-stream" } });
      toast.success("Modèle ajouté");
      setName(""); setOrg(""); setFile(null);
      onCreated();
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Importer un modèle</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Nom</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Note de frais CHU Bordeaux" /></div>
          <div><Label className="text-xs">Organisation</Label><Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="CHU de Bordeaux" /></div>
          <div>
            <Label className="text-xs">Fichier (Excel, PDF, Word)</Label>
            <Input type="file" accept=".xlsx,.xls,.pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
