import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Share2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getSpacePublicSettings, setSpacePublic } from "@/lib/collab.functions";

export function SpaceShareButton({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const getFn = useServerFn(getSpacePublicSettings);
  const setFn = useServerFn(setSpacePublic);
  const qc = useQueryClient();
  const key = ["space-public", spaceId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { spaceId } }),
    enabled: open,
  });
  const space = data?.space;

  const [isPublic, setIsPublic] = useState(false);
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // initialize state when data loads
  if (space && !saving && data && (isPublic !== space.is_public || desc !== (space.public_description ?? ""))) {
    // simple sync once per data
  }

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      // reset to fetched after a tick
      setTimeout(() => {
        if (space) {
          setIsPublic(space.is_public);
          setDesc(space.public_description ?? "");
        }
      }, 50);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await setFn({
        data: { spaceId, is_public: isPublic, public_description: desc || null },
      });
      toast.success(isPublic ? "Espace rendu public" : "Espace remis en privé");
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = space?.public_token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/space/${space.public_token}`
    : "";

  const copyLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    toast.success("Lien copié");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Partager">
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Partager cet espace</DialogTitle>
        </DialogHeader>
        {isLoading || !space ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="pub-switch" className="cursor-pointer">
                Rendre public
              </Label>
              <Switch
                id="pub-switch"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
            </div>
            <div>
              <Label className="text-xs">Description publique (optionnelle)</Label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                placeholder="Présentation affichée aux visiteurs externes"
              />
            </div>
            {space.is_public && (
              <div>
                <Label className="text-xs">Lien public</Label>
                <div className="flex gap-1">
                  <Input value={publicUrl} readOnly className="text-xs" />
                  <Button size="icon" variant="outline" onClick={copyLink} title="Copier">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="outline" asChild title="Ouvrir">
                    <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Les visiteurs verront le nom de l'espace, la description et les sondages ouverts.
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button>
          <Button onClick={save} disabled={saving || isLoading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
