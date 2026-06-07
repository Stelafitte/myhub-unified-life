import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Trash2, CheckCircle2, XCircle, Webhook, Copy } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { confirmDialog } from "@/lib/confirm-dialog";
import {
  listWaConnections,
  saveWaConnection,
  testWaConnection,
  setWaConnectionActive,
  deleteWaConnection,
  getWaWebhookSetup,
  getWaSecretsDefaults,
} from "@/lib/whatsapp.functions";

type FormState = {
  phone_number_id: string;
  wa_business_account_id: string;
  access_token: string;
  phone_number: string;
  display_name: string;
};

const EMPTY: FormState = {
  phone_number_id: "",
  wa_business_account_id: "",
  access_token: "",
  phone_number: "",
  display_name: "",
};

export function WhatsAppSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWaConnections);
  const saveFn = useServerFn(saveWaConnection);
  const testFn = useServerFn(testWaConnection);
  const toggleFn = useServerFn(setWaConnectionActive);
  const deleteFn = useServerFn(deleteWaConnection);
  const webhookFn = useServerFn(getWaWebhookSetup);
  const secretsFn = useServerFn(getWaSecretsDefaults);
  const [importing, setImporting] = useState(false);

  const handleImportSecrets = async () => {
    setImporting(true);
    try {
      const s = await secretsFn();
      if (!s.has_secrets) {
        toast.error("Aucun secret WhatsApp configuré côté backend");
        return;
      }
      setForm({
        phone_number_id: s.phone_number_id,
        wa_business_account_id: s.wa_business_account_id,
        access_token: s.access_token,
        phone_number: s.phone_number || "",
        display_name: s.display_name || "",
      });
      toast.success("Champs pré-remplis depuis les secrets");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setImporting(false);
    }
  };

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["wa-connections"],
    queryFn: () => listFn(),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<{
    webhook_url: string;
    verify_token: string;
    subscribed_fields: string[];
  } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["wa-connections"] });

  const handleTest = async () => {
    if (!form.phone_number_id || !form.access_token) {
      toast.error("Renseigne le phone_number_id et le token");
      return;
    }
    setTesting(true);
    try {
      const r = await testFn({ data: { phone_number_id: form.phone_number_id, access_token: form.access_token } });
      if (r.ok) {
        toast.success(`Connexion OK — ${r.phone_number ?? form.phone_number_id}`);
        setForm((f) => ({
          ...f,
          phone_number: f.phone_number || (r.phone_number ?? ""),
          display_name: f.display_name || (r.display_name ?? ""),
        }));
      } else {
        toast.error(`Échec: ${r.error}`);
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.phone_number_id || !form.wa_business_account_id || !form.access_token || !form.phone_number) {
      toast.error("Tous les champs marqués * sont requis");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: form });
      toast.success("Connexion WhatsApp enregistrée");
      setOpen(false);
      setForm(EMPTY);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!(await confirmDialog(`Supprimer la connexion ${label} ?`))) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Supprimée");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleToggle = async (id: string, is_active: boolean) => {
    try {
      await toggleFn({ data: { id, is_active } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleShowWebhook = async (id: string) => {
    try {
      const info = await webhookFn({ data: { id } });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setWebhookInfo({ ...info, webhook_url: `${origin}${info.webhook_url}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success("Copié");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp Business</h2>
          <p className="text-sm text-muted-foreground">
            Connecte ton numéro WhatsApp Business via Meta Cloud API
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm(EMPTY); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Ajouter
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Aucune connexion WhatsApp Business. Clique sur Ajouter pour en créer une.
          </CardContent>
        </Card>
      ) : (
        connections.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-green-600" />
                  {c.display_name || c.phone_number}
                  {c.is_active ? (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Actif</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1"><XCircle className="h-3 w-3" />Inactif</Badge>
                  )}
                </CardTitle>
                <Switch checked={c.is_active} onCheckedChange={(v) => handleToggle(c.id, v)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="text-muted-foreground">📞 {c.phone_number}</div>
              <div className="text-xs font-mono text-muted-foreground">
                phone_id: {c.phone_number_id} · waba: {c.wa_business_account_id}
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => handleShowWebhook(c.id)}>
                  <Webhook className="h-4 w-4 mr-2" /> Webhook
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(c.id, c.phone_number)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connecter WhatsApp Business</DialogTitle>
            <DialogDescription>
              Récupère ces informations dans Meta Business Suite → WhatsApp → API Setup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Phone Number ID *" value={form.phone_number_id} onChange={(v) => setForm({ ...form, phone_number_id: v })} placeholder="123456789012345" />
            <Field label="WhatsApp Business Account ID *" value={form.wa_business_account_id} onChange={(v) => setForm({ ...form, wa_business_account_id: v })} placeholder="987654321098765" />
            <Field label="Access Token (permanent) *" value={form.access_token} onChange={(v) => setForm({ ...form, access_token: v })} placeholder="EAAxxxxxx…" type="password" />
            <Field label="Numéro affiché *" value={form.phone_number} onChange={(v) => setForm({ ...form, phone_number: v })} placeholder="+33612345678" />
            <Field label="Nom affiché" value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} placeholder="Mon Business" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? "Test…" : "Tester"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!webhookInfo} onOpenChange={(o) => !o && setWebhookInfo(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configuration du webhook Meta</DialogTitle>
            <DialogDescription>
              Colle ces valeurs dans Meta Business Suite → WhatsApp → Configuration → Webhooks.
            </DialogDescription>
          </DialogHeader>
          {webhookInfo && (
            <div className="space-y-3 text-sm">
              <CopyRow label="Callback URL" value={webhookInfo.webhook_url} onCopy={copy} />
              <CopyRow label="Verify Token" value={webhookInfo.verify_token} onCopy={copy} />
              <div>
                <Label className="text-xs">Champs à abonner</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {webhookInfo.subscribed_fields.map((f) => (
                    <Badge key={f} variant="secondary">{f}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} />
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex gap-2">
        <Input value={value} readOnly className="font-mono text-xs" />
        <Button size="icon" variant="outline" onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
