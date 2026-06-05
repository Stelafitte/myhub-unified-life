import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Underline } from "@tiptap/extension-underline";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  saveCollabDocument,
  uploadDocumentImage,
} from "@/lib/collab-documents.functions";
import type { EditorialAction } from "@/lib/collab-ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  MicOff,
  Sparkles,
  MessageSquare,
  History,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { SlashMenu, type SlashItem } from "./slash-menu";
import { AIPreviewDialog, ACTION_LABELS } from "./ai-preview-dialog";
import { useVoiceDictation } from "./use-voice-dictation";
import { CommentsPanel } from "./comments-panel";
import { VersionHistoryDialog } from "./version-history-dialog";
import { useDocumentRealtime } from "./use-document-realtime";

const AUTOSAVE_INTERVAL_MS = 30_000;

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

const AI_MENU: { action: EditorialAction; needsSelection: boolean }[] = [
  { action: "improve", needsSelection: true },
  { action: "shorten", needsSelection: true },
  { action: "lengthen", needsSelection: true },
  { action: "simplify", needsSelection: true },
  { action: "fix_grammar", needsSelection: true },
  { action: "change_tone", needsSelection: true },
  { action: "translate", needsSelection: true },
  { action: "summarize", needsSelection: true },
  { action: "to_bullets", needsSelection: true },
  { action: "continue", needsSelection: false },
];

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

  // Slash menu
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const slashStartRef = useRef<number | null>(null); // doc position of the "/"

  // AI dialog
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAction, setAiAction] = useState<EditorialAction | null>(null);
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiContext, setAiContext] = useState<string>("");

  // Comments + history
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<
    { text: string; from: number; to: number } | null
  >(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Underline,
      Link.configure({ openOnClick: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      StorageImage,
      Placeholder.configure({ placeholder: "Commencez à écrire… ou tapez « / » pour les commandes" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "tiptap-content focus:outline-none min-h-[60vh] px-4 py-4 text-base leading-relaxed",
      },
    },
    onUpdate: ({ editor }) => {
      dirtyRef.current = true;
      // Slash menu detection
      const { from } = editor.state.selection;
      if (slashStartRef.current !== null) {
        if (from < slashStartRef.current) {
          closeSlash();
          return;
        }
        const text = editor.state.doc.textBetween(slashStartRef.current, from, "\n", "\n");
        if (!text.startsWith("/") || text.includes(" ") || text.includes("\n")) {
          closeSlash();
          return;
        }
        setSlashQuery(text.slice(1));
      } else {
        // Detect a freshly-typed "/" at start of a node or after space
        const $from = editor.state.selection.$from;
        const lastChar = editor.state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n");
        if (lastChar === "/") {
          const before = editor.state.doc.textBetween(
            Math.max(0, from - 2),
            from - 1,
            "\n",
            "\n",
          );
          const atNodeStart = $from.parentOffset === 1;
          if (atNodeStart || before === " " || before === "" || before === "\n") {
            openSlashAt(from - 1);
          }
        }
      }
    },
  });

  const openSlashAt = (pos: number) => {
    if (!editor) return;
    slashStartRef.current = pos;
    setSlashQuery("");
    try {
      const coords = editor.view.coordsAtPos(pos);
      setSlashPos({ top: coords.bottom + 4, left: coords.left });
    } catch {
      setSlashPos({ top: 100, left: 100 });
    }
    setSlashOpen(true);
  };

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    slashStartRef.current = null;
  }, []);

  const removeSlashText = useCallback(() => {
    if (!editor || slashStartRef.current === null) return;
    const start = slashStartRef.current;
    const end = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from: start, to: end }).run();
    slashStartRef.current = null;
  }, [editor]);

  // Voice dictation
  const voice = useVoiceDictation({
    lang: "fr-FR",
    onFinal: (text) => {
      if (!editor) return;
      const t = text.trim();
      if (!t) return;
      editor.chain().focus().insertContent(t + " ").run();
    },
  });

  // Realtime: comments + remote document edits (other tabs/devices)
  useDocumentRealtime({
    documentId,
    onCommentsChange: () => setCommentsRefreshKey((k) => k + 1),
    onVersionsChange: () => setCommentsRefreshKey((k) => k + 1),
    onDocumentUpdate: () => {
      // Avoid noisy banner if our own save just landed
      if (saving) return;
      setRemoteUpdateAvailable(true);
    },
  });

  const openCommentsWithSelection = () => {
    if (editor) {
      const { from, to } = editor.state.selection;
      if (to > from) {
        const text = editor.state.doc.textBetween(from, to, "\n", "\n");
        setPendingAnchor({ text, from, to });
      } else {
        setPendingAnchor(null);
      }
    }
    setCommentsOpen(true);
  };


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

  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) performSave(true);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [performSave]);

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

  // === AI ===
  const openAI = (action: EditorialAction) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "\n", "\n");
    const needsSel = AI_MENU.find((m) => m.action === action)?.needsSelection;
    if (needsSel && !selected.trim()) {
      toast.error("Sélectionne d'abord un passage de texte.");
      return;
    }
    const ctxStart = Math.max(0, from - 1500);
    const ctxBefore = editor.state.doc.textBetween(ctxStart, from, "\n", "\n");
    setAiAction(action);
    setAiSelectedText(selected);
    setAiContext(ctxBefore);
    setAiOpen(true);
  };

  const applySuggestion = (suggestion: string, _action: EditorialAction, isContinuation: boolean) => {
    if (!editor) return;
    if (isContinuation) {
      const insertion = (editor.state.doc.textBetween(
        Math.max(0, editor.state.selection.from - 1),
        editor.state.selection.from,
        "\n",
        "\n",
      ).endsWith(" ") ? "" : " ") + suggestion;
      editor.chain().focus().insertContent(insertion).run();
    } else {
      const { from, to } = editor.state.selection;
      if (from === to) {
        editor.chain().focus().insertContent(suggestion).run();
      } else {
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContent(suggestion)
          .run();
      }
    }
    toast.success("Suggestion appliquée");
    dirtyRef.current = true;
  };

  // Slash menu picks
  const onPickFormat = (item: SlashItem) => {
    if (!editor || !item.run) return;
    removeSlashText();
    item.run(editor);
    closeSlash();
  };
  const onPickAI = (action: EditorialAction) => {
    removeSlashText();
    closeSlash();
    openAI(action);
  };
  const onPickVoice = () => {
    removeSlashText();
    closeSlash();
    if (!voice.supported) {
      toast.error("Dictée vocale non supportée par ce navigateur.");
      return;
    }
    if (voice.listening) voice.stop();
    else voice.start();
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
              {savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
            variant={voice.listening ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (!voice.supported) {
                toast.error("Dictée vocale non supportée par ce navigateur.");
                return;
              }
              if (voice.listening) {
                voice.stop();
                toast.message("Dictée arrêtée");
              } else {
                voice.start();
                toast.message("Dictée en cours… parlez");
              }
            }}
            title={voice.supported ? "Dictée vocale (Web Speech)" : "Non supporté par ce navigateur"}
          >
            {voice.listening ? (
              <MicOff className="h-4 w-4 mr-1" />
            ) : (
              <Mic className="h-4 w-4 mr-1" />
            )}
            {voice.listening ? "Stop" : "Vocal"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title="Assistant IA">
                <Sparkles className="h-4 w-4 mr-1" />
                IA
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Sur la sélection</DropdownMenuLabel>
              {AI_MENU.filter((m) => m.needsSelection).map((m) => (
                <DropdownMenuItem key={m.action} onClick={() => openAI(m.action)}>
                  <Sparkles className="h-3.5 w-3.5 mr-2" />
                  {ACTION_LABELS[m.action]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Au curseur</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openAI("continue")}>
                <Sparkles className="h-3.5 w-3.5 mr-2" />
                {ACTION_LABELS.continue}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  openCommentsWithSelection();
                }}
                title="Commentaires"
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                Commentaires
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[400px] sm:w-[440px] p-0 flex flex-col">
              <CommentsPanel
                documentId={documentId}
                pendingAnchor={pendingAnchor}
                onConsumeAnchor={() => setPendingAnchor(null)}
                refreshKey={commentsRefreshKey}
              />
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            title="Historique des versions"
          >
            <History className="h-4 w-4 mr-1" />
            Historique
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

      {remoteUpdateAvailable && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
          <span>Ce document a été modifié ailleurs. Recharge pour voir la dernière version.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="ml-2"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Recharger
          </Button>
        </div>
      )}


      {/* Editor */}
      <div className="border rounded-md bg-background relative">
        <EditorContent editor={editor} />
        {voice.listening && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-red-500/10 text-red-600 px-2 py-0.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Dictée…
          </div>
        )}
      </div>

      <SlashMenu
        editor={editor}
        open={slashOpen}
        query={slashQuery}
        position={slashPos}
        onClose={closeSlash}
        onPickFormat={onPickFormat}
        onPickAI={onPickAI}
        onPickVoice={onPickVoice}
      />

      <AIPreviewDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        action={aiAction}
        selectedText={aiSelectedText}
        contextBefore={aiContext}
        onAccept={applySuggestion}
      />

      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        documentId={documentId}
        onRestored={() => {
          // Force a reload so the editor picks up the restored content
          window.location.reload();
        }}
      />
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
