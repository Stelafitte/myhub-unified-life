import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  createContactGroup,
  listCollabSpacesForGroups,
  listWhatsAppSendersForSpace,
  type GroupType,
  type SmartRules,
} from "@/lib/contacts.functions";

type Space = { id: string; name: string; parent_id: string | null; level: number };
type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  email: string[] | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  defaultSpaceId?: string | null;
  defaultType?: GroupType;
};

export function GroupFormDialog({
  open,
  onOpenChange,
  onCreated,
  defaultSpaceId = null,
  defaultType = "manual",
}: Props) {
  const { user } = useAuth();
  const createFn = useServerFn(createContactGroup);
  const listSpacesFn = useServerFn(listCollabSpacesForGroups);
  const listSendersFn = useServerFn(listWhatsAppSendersForSpace);

  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupType, setGroupType] = useState<GroupType>(defaultType);
  const [spaceId, setSpaceId] = useState<string | null>(defaultSpaceId);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [smartRules, setSmartRules] = useState<SmartRules>({});

  // Manual picker state
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [externalInput, setExternalInput] = useState("");
  const [externals, setExternals] = useState<string[]>([]);

  // WhatsApp senders state
  const [waSenders, setWaSenders] = useState<Array<{ key: string; name: string | null }>>([]);
  const [waLoading, setWaLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setGroupType(defaultType);
    setSpaceId(defaultSpaceId);
    setSmartRules({});
    setPicked(new Set());
    setExternals([]);
    setQuery("");
    setExternalInput("");
    setWaSenders([]);
    listSpacesFn().then((r) => setSpaces((r.spaces ?? []) as Space[]));
    if (user) {
      supabase
        .from("contacts")
        .select("id, first_name, last_name, organization, email")
        .eq("user_id", user.id)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(500)
        .then(({ data }) => setContacts((data ?? []) as ContactRow[]));
    }
  }, [open, user, defaultSpaceId, defaultType, listSpacesFn]);

  useEffect(() => {
    if (groupType !== "whatsapp" || !spaceId) {
      setWaSenders([]);
      return;
    }
    setWaLoading(true);
    listSendersFn({ data: { spaceId } })
      .then((r) => setWaSenders(r.senders ?? []))
      .finally(() => setWaLoading(false));
  }, [groupType, spaceId, listSendersFn]);

  const filteredContacts = contacts.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
    return (
      name.includes(q) ||
      (c.organization ?? "").toLowerCase().includes(q) ||
      (c.email ?? []).some((e) => e.toLowerCase().includes(q))
    );
  });

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addExternal = () => {
    const v = externalInput.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Email invalide");
      return;
    }
    if (!externals.includes(v)) setExternals((p) => [...p, v]);
    setExternalInput("");
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Nom obligatoire");
      return;
    }
    if (groupType === "space" && !spaceId) {
      toast.error("Choisis un espace collaboratif");
      return;
    }
    if (groupType === "whatsapp" && !spaceId) {
      toast.error("Choisis l'espace WhatsApp source");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        group_type: groupType,
        space_id: spaceId,
        source: "user" as const,
        smart_rules: groupType === "smart" ? smartRules : undefined,
        initial_contact_ids: groupType === "manual" ? Array.from(picked) : undefined,
        initial_external_emails: groupType === "manual" ? externals : undefined,
        whatsapp_senders: groupType === "whatsapp" ? waSenders : undefined,
      };
      await createFn({ data: payload });
      toast.success("Groupe créé");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la création");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouveau groupe de contacts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Nom *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Comité FMC CP" />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optionnel"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={groupType} onValueChange={(v) => setGroupType(v as GroupType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manuel</SelectItem>
                  <SelectItem value="smart">🤖 Smart (règles)</SelectItem>
                  <SelectItem value="space">Depuis un espace</SelectItem>
                  
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Espace collaboratif lié</Label>
              <Select
                value={spaceId ?? "none"}
                onValueChange={(v) => setSpaceId(v === "none" ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {"— ".repeat(s.level)}{s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {groupType === "smart" && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="text-sm font-medium">Règles dynamiques</div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Organisation contient…"
                  value={smartRules.org_contains ?? ""}
                  onChange={(e) =>
                    setSmartRules((r) => ({ ...r, org_contains: e.target.value || undefined }))
                  }
                />
                <Input
                  placeholder="Tag contient…"
                  value={smartRules.tag_contains ?? ""}
                  onChange={(e) =>
                    setSmartRules((r) => ({ ...r, tag_contains: e.target.value || undefined }))
                  }
                />
                <Input
                  placeholder="Domaine email (ex: chu-bordeaux.fr)"
                  value={smartRules.email_domain ?? ""}
                  onChange={(e) =>
                    setSmartRules((r) => ({ ...r, email_domain: e.target.value || undefined }))
                  }
                />
                <Select
                  value={smartRules.source ?? "any"}
                  onValueChange={(v) =>
                    setSmartRules((r) => ({
                      ...r,
                      source: v === "any" ? undefined : (v as "google" | "icloud" | "outlook"),
                    }))
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Toutes sources</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="icloud">iCloud</SelectItem>
                    <SelectItem value="outlook">Outlook</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  placeholder="Échangé email dans les N derniers jours"
                  value={smartRules.emailed_within_days ?? ""}
                  onChange={(e) =>
                    setSmartRules((r) => ({
                      ...r,
                      emailed_within_days: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Le groupe se recalcule automatiquement à chaque ouverture et peut être resynchronisé manuellement.
              </p>
            </div>
          )}

          {groupType === "manual" && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Rechercher un contact (nom, email, organisation)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                {filteredContacts.slice(0, 50).map((c) => {
                  const isPicked = picked.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                            c.email?.[0] ||
                            "Sans nom"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {c.organization ?? c.email?.[0] ?? ""}
                        </div>
                      </div>
                      {isPicked && <Check className="size-4 text-primary" />}
                    </button>
                  );
                })}
                {filteredContacts.length === 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground">Aucun contact</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {picked.size > 0 && (
                  <Badge variant="secondary">{picked.size} sélectionné(s)</Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label>Emails externes (non dans les contacts)</Label>
                <div className="flex gap-2">
                  <Input
                    value={externalInput}
                    onChange={(e) => setExternalInput(e.target.value)}
                    placeholder="ajout@example.com"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExternal())}
                  />
                  <Button type="button" variant="outline" onClick={addExternal}>
                    Ajouter
                  </Button>
                </div>
                {externals.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {externals.map((em) => (
                      <Badge key={em} variant="outline" className="gap-1">
                        {em}
                        <button
                          type="button"
                          onClick={() => setExternals((p) => p.filter((x) => x !== em))}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {groupType === "space" && (
            <p className="text-sm text-muted-foreground">
              Tous les membres connus de l'espace (participants de réunions, expéditeurs WhatsApp)
              seront ajoutés au groupe.
            </p>
          )}

          {groupType === "whatsapp" && (
            <div className="space-y-2">
              {waLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Analyse des expéditeurs…
                </div>
              ) : (
                <>
                  <div className="text-sm">
                    {waSenders.length} expéditeur(s) unique(s) détecté(s)
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-xs">
                    {waSenders.map((s) => (
                      <div key={s.key} className="truncate">
                        {s.name ?? s.key}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
