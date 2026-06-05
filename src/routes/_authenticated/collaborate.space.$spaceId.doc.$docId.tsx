import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCollabDocument } from "@/lib/collab-documents.functions";
import { refreshOffice365Document } from "@/lib/collab-office365.functions";
import { DocumentEditor } from "@/components/collaborate/document-editor";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/collaborate/space/$spaceId/doc/$docId")({
  component: DocumentEditorPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive mb-3">Erreur : {error.message}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Réessayer</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Document introuvable.</div>,
  head: () => ({ meta: [{ title: "Document – MyHub Pro" }] }),
});

interface DocFull {
  id: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
  version_count: number;
  doc_type: string;
  office_provider: string | null;
  office_url: string | null;
  office_thumbnail_url: string | null;
  office_synced_at: string | null;
}

function DocumentEditorPage() {
  const { spaceId, docId } = Route.useParams();
  const getFn = useServerFn(getCollabDocument);
  const refreshFn = useServerFn(refreshOffice365Document);
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await getFn({ data: { documentId: docId } });
        setDoc(res.document as DocFull);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [docId, getFn]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshFn({ data: { documentId: docId } });
      toast.success("Métadonnées synchronisées");
      setDoc((d) =>
        d
          ? {
              ...d,
              title: r.title,
              office_url: r.webUrl,
              office_thumbnail_url: r.thumbnailUrl,
              office_synced_at: new Date().toISOString(),
            }
          : d,
      );
    } catch (e) {
      toast.error("Synchronisation échouée", {
        description: (e as Error).message,
      });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Chargement du document…
      </div>
    );
  }

  if (err || !doc) {
    return (
      <div className="p-6">
        <Link to="/collaborate/space/$spaceId" params={{ spaceId }} className="text-sm text-muted-foreground hover:underline inline-flex items-center mb-3">
          <ChevronLeft className="h-3 w-3 mr-1" /> Retour à l'espace
        </Link>
        <p className="text-destructive">{err ?? "Document introuvable"}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      <Link to="/collaborate/space/$spaceId" params={{ spaceId }} className="text-sm text-muted-foreground hover:underline inline-flex items-center mb-3">
        <ChevronLeft className="h-3 w-3 mr-1" /> Retour à l'espace
      </Link>
      {doc.doc_type === "office" ? (
        <div className="border rounded-md p-6 bg-background">
          <h1 className="text-2xl font-semibold mb-2">{doc.title}</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Document Office 365 ({doc.office_provider ?? "onedrive"})
            {doc.office_synced_at && (
              <> · synchronisé le {new Date(doc.office_synced_at).toLocaleString("fr-FR")}</>
            )}
          </p>
          {doc.office_thumbnail_url && (
            <img
              src={doc.office_thumbnail_url}
              alt={doc.title}
              className="rounded-md border mb-4 max-w-md"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {doc.office_url && (
              <Button asChild>
                <a href={doc.office_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Ouvrir dans Office 365
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Resynchroniser
            </Button>
          </div>
        </div>
      ) : (
        <DocumentEditor
          documentId={doc.id}
          initialTitle={doc.title}
          initialContent={doc.content}
          versionCount={doc.version_count}
        />
      )}
    </div>
  );
}
