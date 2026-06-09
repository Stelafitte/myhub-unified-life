import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Trash2, Save, Upload, Download, Sparkles, FileText, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  listOrganizations, upsertOrganization, deleteOrganization,
  getOrganizationTemplateUrl, analyzeOrganizationTemplate,
} from "@/lib/expense.functions";

type Org = {
  id: string;
  name: string;
  legal_name: string | null;
  address: string | null;
  contact_email: string | null;
  template_path: string | null;
  template_filename: string | null;
  template_mime: string | null;
  template_file_type: string | null;
  ai_mapping: any;
};

export function OrganizationDialog({
  open, onOpenChange, userId, onChanged, initialEditId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  userId: string; onChanged?: () => void; initialEditId?: string | null;
}) {
  const listFn = useServerFn(listOrganizations);
  const upsertFn = useServerFn(upsertOrganization);
  const delFn = useServerFn(deleteOrganization);
  const urlFn = useServerFn(getOrganizationTemplateUrl);
  const analyzeFn = useServerFn(analyzeOrganizationTemplate);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Org | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await listFn();
      setOrgs(r.organizations as Org[]);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (open) void reload();
  }, [open]);

  useEffect(() => {
    if (!open || !initialEditId) return;
    const o = orgs.find((x) => x.id === initialEditId);
    if (o) startEdit(o);
  }, [open, initialEditId, orgs]);

  const startNew = () => {
    setEditing({ id: "", name: "", legal_name: "", address: "", contact_email: "", template_path: null, template_filename: null, template_mime: null, template_file_type: null, ai_mapping: {} });
    setName(""); setLegalName(""); setAddress(""); setContactEmail(""); setFile(null);
  };
  const startEdit = (o: Org) => {
    setEditing(o);
    setName(o.name); setLegalName(o.legal_name ?? ""); setAddress(o.address ?? ""); setContactEmail(o.contact_email ?? ""); setFile(null);
  };
  const back = () => { setEditing(null); setFile(null); };

  const save = async () => {
    if (!name.trim()) { toast.error("Nom requis"); return; }
    setSaving(true);
    try {
      let template_path: string | null = null;
      let template_filename: string | null = null;
      let template_mime: string | null = null;
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw new Error("Fichier > 8 Mo");
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${userId}/org-templates/${Date.now()}_${safe}`;
        const { error } = await supabase.storage.from("expense-receipts").upload(path, file, { contentType: file.type });
        if (error) throw error;
        template_path = path; template_filename = file.name; template_mime = file.type || "application/octet-stream";
      }
      await upsertFn({ data: {
        id: editing?.id || undefined,
        name, legal_name: legalName || null, address: address || null, contact_email: contactEmail || null,
        template_path, template_filename, template_mime,
      } });
      toast.success("Organisme enregistré");
      setFile(null);
      await reload();
      onChanged?.();
      back();
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cet organisme ?")) return;
    try { await delFn({ data: { id } }); toast.success("Supprimé"); await reload(); onChanged?.(); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
  };

  const downloadTpl = async (id: string) => {
    try {
      const { url, filename } = await urlFn({ data: { id } });
      const a = document.createElement("a"); a.href = url; a.download = filename; a.target = "_blank"; a.click();
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); }
  };

  const analyze = async (id: string) => {
    setAnalyzingId(id);
    try { await analyzeFn({ data: { id } }); toast.success("Modèle analysé"); await reload(); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setAnalyzingId(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? (<><Button size="sm" variant="ghost" onClick={back} className="h-7 w-7 p-0"><ArrowLeft className="h-4 w-4" /></Button>{editing.id ? "Modifier l'organisme" : "Nouvel organisme"}</>) : "Organismes invitants"}
          </DialogTitle>
        </DialogHeader>

        {!editing ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <Button size="sm" onClick={startNew} className="gap-1"><Plus className="h-4 w-4" /> Nouvel organisme</Button>
            </div>
            {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              : orgs.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Aucun organisme enregistré.</p>
              : orgs.map((o) => (
                <Card key={o.id} className="p-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{o.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[o.legal_name, o.contact_email].filter(Boolean).join(" · ") || "—"}
                      {o.template_filename ? ` · 📎 ${o.template_filename}` : ""}
                    </p>
                  </div>
                  {o.template_path && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => downloadTpl(o.id)} className="h-8 w-8 p-0" title="Télécharger le modèle"><Download className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => analyze(o.id)} disabled={analyzingId === o.id} className="h-8 w-8 p-0" title="Analyser par IA">
                        {analyzingId === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => startEdit(o)} className="h-8">Modifier</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(o.id)} className="h-8 w-8 p-0"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </Card>
              ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label className="text-xs">Nom court (affiché)</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CHU Bordeaux" /></div>
            <div><Label className="text-xs">Raison sociale</Label><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Centre Hospitalier Universitaire de Bordeaux" /></div>
            <div><Label className="text-xs">Adresse</Label><Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-[60px]" /></div>
            <div><Label className="text-xs">Email de contact</Label><Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="comptabilite@…" /></div>
            <div>
              <Label className="text-xs">Modèle de note de frais (PDF, Excel, Word)</Label>
              {editing.template_filename && !file && (
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Actuel : {editing.template_filename}
                  <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => editing.id && downloadTpl(editing.id)}>Télécharger</Button>
                </p>
              )}
              <Input type="file" accept=".pdf,.xlsx,.xls,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground mt-1">Ce fichier sera rempli automatiquement par l'IA et joint au mail envoyé à l'organisme.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={back}>Annuler</Button>
              <Button onClick={save} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
