import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Loader2 } from "lucide-react";
import { WhatsappImportDialog } from "./whatsapp-import-dialog";

interface Space {
  id: string;
  name: string;
  description: string | null;
  type: string;
  icon: string | null;
  color: string | null;
  whatsapp_group_name?: string | null;
}

export function SpacesList() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [importSpace, setImportSpace] = useState<Space | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("collab_spaces")
      .select("id, name, description, type, icon, color")
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (!error && data) setSpaces(data as Space[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Chargement des espaces…
      </div>
    );
  }

  if (spaces.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Aucun espace collaboratif. Créez-en un pour commencer.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((s) => (
          <Card key={s.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md text-lg"
                  style={{ backgroundColor: (s.color ?? "#64748b") + "20", color: s.color ?? undefined }}
                >
                  {s.icon ?? "📁"}
                </span>
                <span className="flex-1 truncate">{s.name}</span>
              </CardTitle>
              {s.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.description}</p>
              )}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-end gap-2">
              <Badge variant="secondary" className="self-start text-xs">
                {s.type}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setImportSpace(s)}
              >
                <Smartphone className="h-4 w-4 mr-2" />
                Importer historique WhatsApp
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {importSpace && (
        <WhatsappImportDialog
          open={!!importSpace}
          onOpenChange={(v) => !v && setImportSpace(null)}
          spaceId={importSpace.id}
          spaceName={importSpace.name}
        />
      )}
    </>
  );
}
