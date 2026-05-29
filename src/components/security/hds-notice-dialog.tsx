import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Affiché une fois pour informer l'utilisateur du dispositif RGPD/HDS.
 * Stocke profiles.hds_notice_accepted_at à l'acceptation.
 */
export function HdsNoticeDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("hds_notice_accepted_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (!data?.hds_notice_accepted_at) setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function accept() {
    if (!user?.id) return;
    setSubmitting(true);
    await supabase
      .from("profiles")
      .update({ hds_notice_accepted_at: new Date().toISOString() })
      .eq("id", user.id);
    setSubmitting(false);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => v || accept()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Protection des données de santé
          </DialogTitle>
          <DialogDescription className="pt-2 text-left text-sm leading-relaxed text-foreground/80">
            MyHub Pro détecte automatiquement les emails susceptibles de
            contenir des données de santé à caractère personnel. Ces emails
            sont signalés et exclus de l'analyse par intelligence artificielle,
            conformément au Règlement Général sur la Protection des Données
            (RGPD) et au cadre français d'Hébergement de Données de Santé (HDS).
            <br />
            <br />
            En tant que professionnel de santé, vous restez responsable du
            traitement de ces données sur votre appareil. Vous pourrez bientôt
            configurer leur isolation locale chiffrée dans Paramètres →
            Sécurité & Conformité.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={accept} disabled={submitting} className="w-full">
            J'ai compris
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
