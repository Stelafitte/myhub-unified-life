import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, LockOpen, ShieldAlert, Trash2, Loader2, Mail } from "lucide-react";
import { useSecureVault } from "@/lib/secure-vault-context";
import { VaultPinDialog } from "@/components/security/vault-pin-dialog";
import { Button } from "@/components/ui/button";
import { listVaultItems, getEmail, deleteEmail, type VaultItem, type VaultEmail } from "@/lib/secure-vault";
import { toast } from "sonner";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/lib/confirm-dialog";

export const Route = createFileRoute("/_authenticated/secure-box")({
  component: SecureBoxPage,
});

function SecureBoxPage() {
  const { unlocked, key, initialized, lock, refreshCount } = useSecureVault();
  const [pinOpen, setPinOpen] = useState(false);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selected, setSelected] = useState<VaultEmail | null>(null);
  const [loadingSel, setLoadingSel] = useState(false);

  useEffect(() => {
    if (unlocked) listVaultItems().then(setItems);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked && !initialized) setPinOpen(true);
  }, [unlocked, initialized]);

  async function openItem(it: VaultItem) {
    if (!key) return;
    setLoadingSel(true);
    try {
      const e = await getEmail(key, it.id);
      setSelected(e);
    } catch {
      toast.error("Impossible de déchiffrer ce message");
    } finally {
      setLoadingSel(false);
    }
  }

  async function removeItem(id: string) {
    if (!await confirmDialog("Supprimer définitivement cet email du coffre ?")) return;
    await deleteEmail(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selected?.id === id) setSelected(null);
    await refreshCount();
    toast.success("Supprimé");
  }

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Lock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Coffre sécurisé verrouillé</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Les emails sensibles (données de santé) sont chiffrés localement.
          Saisissez votre PIN pour y accéder.
        </p>
        <Button className="mt-4" onClick={() => setPinOpen(true)}>
          {initialized ? "Déverrouiller" : "Créer le coffre"}
        </Button>
        <VaultPinDialog open={pinOpen} onOpenChange={setPinOpen} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <aside className="w-80 shrink-0 overflow-y-auto rounded-lg border bg-card">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LockOpen className="h-4 w-4 text-emerald-600" />
            Coffre · {items.length}
          </div>
          <Button size="sm" variant="ghost" onClick={lock} title="Verrouiller">
            <Lock className="h-3.5 w-3.5" />
          </Button>
        </header>
        {items.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Aucun email dans le coffre.
          </div>
        ) : (
          <ul>
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => openItem(it)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm hover:bg-accent/50",
                    selected?.id === it.id && "bg-accent/60",
                  )}
                >
                  <span className="truncate font-medium">{it.preview.from ?? "—"}</span>
                  <span className="truncate text-xs text-muted-foreground">{it.preview.subject ?? "(sans objet)"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    Ajouté {relativeTime(new Date(it.added_at).toISOString())}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex-1 overflow-y-auto rounded-lg border bg-card">
        {loadingSel ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Déchiffrement…
          </div>
        ) : !selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Mail className="mr-2 h-4 w-4" /> Sélectionnez un email
          </div>
        ) : (
          <article className="flex h-full flex-col">
            <header className="border-b p-4">
              <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Données sensibles · {selected.sensitive_reason ?? "motif inconnu"} · jamais transmises à l'IA ou au cloud.
                </span>
              </div>
              <h2 className="text-base font-semibold">{selected.subject ?? "(sans objet)"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.from_name ? `${selected.from_name} ` : ""}&lt;{selected.from_address}&gt;
              </p>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="destructive" onClick={() => removeItem(selected.id)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Supprimer du coffre
                </Button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              {selected.body_html ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: selected.body_html }}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm">{selected.body_text ?? ""}</pre>
              )}
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
