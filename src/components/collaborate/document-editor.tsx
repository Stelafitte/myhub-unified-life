import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  saveCollabDocument,
  uploadDocumentImage,
} from "@/lib/collab-documents.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code2,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Minus,
  Undo2,
  Redo2,
  Loader2,
  Check,
  Mic,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

const AUTOSAVE_INTERVAL_MS = 30_000;

// Image extension carrying our storage path attribute for signed-URL refresh
const StorageImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-storage-path": {
        default: null,
        parseHTML: (el) => el.getAttribute("data-storage-path"),
        renderHTML: (attrs) =>
          attrs["data-storage-path"]
            ? { "data-storage-path": attrs["data-storage-path"] as string }
            : {},
      },
    };
  },
});

interface DocumentEditorProps {
  documentId: string;
  initialTitle: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialContent: any;
  versionCount: number;
}

export function DocumentEditor({
  documentId,
  initialTitle,
  initialContent,
  versionCount,
}: DocumentEditorProps) {
  const saveFn = useServerFn(saveCollabDocument);
  const uploadFn = useServerFn(uploadDocumentImage);

  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [currentVersion, setCurrentVersion] = useState(versionCount);
  const dirtyRef = useRef(false);
  const lastSavedSerialized = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Underline,
      Link.configure({ openOnClick: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      StorageImage,
      Placeholder.configure({ placeholder: "Commencez à écrire…" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none min-h-[60vh] px-2 py-4",
      },
    },
    onUpdate: () => {
      dirtyRef.current = true;
    },
  });

  const performSave = useCallback(
    async (createVersion: boolean) => {
      if (!editor) return;
      const content = editor.getJSON();
      const serialized = JSON.stringify({ t: title, c: content });
      if (serialized === lastSavedSerialized.current) return;
      try {
        setSaving(true);
        const res = await saveFn({
          data: {
            documentId,
            title: title.trim() || "Document sans titre",
            content: content as Record<string, unknown>,
            createVersion,
          },
        });
        lastSavedSerialized.current = serialized;
        dirtyRef.current = false;
        setSavedAt(new Date(res.savedAt));
        if (res.versionNumber) setCurrentVersion(res.versionNumber);
      } catch (e) {
        toast.error("Sauvegarde échouée", { description: (e as Error).message });
      } finally {
        setSaving(false);
      }
    },
    [editor, title, documentId, saveFn],
  );

  // Autosave every 30s if dirty
  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) performSave(true);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [performSave]);

  // Save on title blur and on unmount
  useEffect(() => {
    return () => {
      if (dirtyRef.current) performSave(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageUpload = async () => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Image trop volumineuse (max 10 Mo)");
        return;
      }
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const dataBase64 = btoa(binary);
      try {
        const res = await uploadFn({
          data: {
            documentId,
            filename: file.name,
            contentType: file.type as
              | "image/png"
              | "image/jpeg"
              | "image/jpg"
              | "image/gif"
              | "image/webp"
              | "image/svg+xml",
            dataBase64,
          },
        });
        editor
          .chain()
          .focus()
          .setImage({
            src: res.signedUrl,
            // @ts-expect-error custom attr
            "data-storage-path": res.storagePath,
          })
          .run();
      } catch (e) {
        toast.error("Upload image échoué", { description: (e as Error).message });
      }
    };
    input.click();
  };

  const handleLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL du lien", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Chargement de l'éditeur…
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Title + status */}
      <div className="flex items-center gap-3 mb-2">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            dirtyRef.current = true;
          }}
          onBlur={() => dirtyRef.current && performSave(false)}
          placeholder="Titre du document"
          className="text-lg font-semibold border-0 px-2 focus-visible:ring-0 shadow-none"
        />
        <div className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Sauvegarde…
            </>
          ) : savedAt ? (
            <>
              <Check className="h-3 w-3 text-green-600" />
              Sauvegardé à{" "}
              {savedAt.toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {currentVersion > 0 && <span className="ml-1">· v{currentVersion}</span>}
            </>
          ) : (
            <span>v{currentVersion}</span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-background border rounded-md mb-3 px-2 py-1 flex flex-wrap items-center gap-1">
        <ToolbarBtn
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Titre 1"
        >
          <Heading1 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Titre 2"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Titre 3"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Gras"
        >
          <Bold className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italique"
        >
          <Italic className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Souligné"
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Barré"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Liste à puces"
        >
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Liste numérotée"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Citation"
        >
          <Quote className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Bloc de code"
        >
          <Code2 className="h-4 w-4" />
        </ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          title="Tableau"
        >
          <TableIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleLink} active={editor.isActive("link")} title="Lien">
          <LinkIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleImageUpload} title="Image">
          <ImageIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Séparateur"
        >
          <Minus className="h-4 w-4" />
        </ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Annuler"
        >
          <Undo2 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Rétablir"
        >
          <Redo2 className="h-4 w-4" />
        </ToolbarBtn>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Vocal : disponible en phase 2")}
            title="Dictée vocale (phase 2)"
          >
            <Mic className="h-4 w-4 mr-1" />
            Vocal
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("IA éditoriale : disponible en phase 2")}
            title="Assistant IA (phase 2)"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            IA
          </Button>
          <Button
            size="sm"
            onClick={() => performSave(true)}
            disabled={saving}
            title="Sauvegarder maintenant"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="border rounded-md bg-background">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-8 w-8 p-0"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  );
}
