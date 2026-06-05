import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCollabDocument } from "@/lib/collab-documents.functions";
import { DocumentEditor } from "@/components/collaborate/document-editor";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";

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
}

function DocumentEditorPage() {
  const { spaceId, docId } = Route.useParams();
  const getFn = useServerFn(getCollabDocument);
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
      <DocumentEditor
        documentId={doc.id}
        initialTitle={doc.title}
        initialContent={doc.content}
        versionCount={doc.version_count}
      />
    </div>
  );
}
