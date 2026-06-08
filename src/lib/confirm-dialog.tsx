import { useEffect, useState } from "react";
import { ShieldAlert, HelpCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & {
  message: string;
  resolve: (value: boolean) => void;
};

const listeners = new Set<(p: Pending | null) => void>();
let currentPending: Pending | null = null;

function emit(p: Pending | null) {
  currentPending = p;
  for (const l of listeners) l(p);
}

/**
 * In-app replacement for window.confirm().
 * Returns a Promise<boolean>. Falls back to false during SSR.
 * Always renders a centered, Hub-branded modal — never a native browser popup.
 */
export function confirmDialog(
  message: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    emit({ message, ...(options ?? {}), resolve });
  });
}

// ---------- Prompt (text input) ----------

export type PromptOptions = {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
};

type PendingPrompt = PromptOptions & {
  message: string;
  resolve: (value: string | null) => void;
};

const promptListeners = new Set<(p: PendingPrompt | null) => void>();
let currentPrompt: PendingPrompt | null = null;

function emitPrompt(p: PendingPrompt | null) {
  currentPrompt = p;
  for (const l of promptListeners) l(p);
}

/** In-app replacement for window.prompt(). Returns the entered string or null. */
export function promptDialog(
  message: string,
  options?: PromptOptions,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    emitPrompt({ message, ...(options ?? {}), resolve });
  });
}
// ---------- Choice (multi-button) ----------

export type ChoiceOption = {
  key: string;
  label: string;
  variant?: "default" | "primary" | "destructive";
};

export type ChoiceDialogOptions = {
  title?: string;
  choices: ChoiceOption[];
  cancelLabel?: string;
};

type PendingChoice = ChoiceDialogOptions & {
  message: string;
  resolve: (value: string | null) => void;
};

const choiceListeners = new Set<(p: PendingChoice | null) => void>();
let currentChoice: PendingChoice | null = null;

function emitChoice(p: PendingChoice | null) {
  currentChoice = p;
  for (const l of choiceListeners) l(p);
}

/** In-app multi-choice dialog. Returns the chosen option key or null if cancelled. */
export function choiceDialog(
  message: string,
  options: ChoiceDialogOptions,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    emitChoice({ message, ...options, resolve });
  });
}


export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(currentPending);
  const [prompt, setPrompt] = useState<PendingPrompt | null>(currentPrompt);
  const [choice, setChoice] = useState<PendingChoice | null>(currentChoice);
  const [value, setValue] = useState("");

  useEffect(() => {
    const l = (p: Pending | null) => setPending(p);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const l = (p: PendingPrompt | null) => {
      setPrompt(p);
      setValue(p?.defaultValue ?? "");
    };
    promptListeners.add(l);
    return () => {
      promptListeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const l = (p: PendingChoice | null) => setChoice(p);
    choiceListeners.add(l);
    return () => {
      choiceListeners.delete(l);
    };
  }, []);

  const close = (result: boolean) => {
    if (pending) pending.resolve(result);
    emit(null);
  };

  const closePrompt = (result: string | null) => {
    if (prompt) prompt.resolve(result);
    emitPrompt(null);
  };

  const closeChoice = (result: string | null) => {
    if (choice) choice.resolve(result);
    emitChoice(null);
  };

  return (
    <>
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <AlertDialogContent className="max-w-md gap-0 overflow-hidden p-0 shadow-2xl">
          <div
            className={
              pending?.destructive
                ? "flex items-center gap-3 border-b bg-destructive/10 px-5 py-3"
                : "flex items-center gap-3 border-b bg-primary/10 px-5 py-3"
            }
          >
            {pending?.destructive ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <HelpCircle className="h-5 w-5 text-primary" />
            )}
            <div className="text-sm font-semibold">
              {pending?.title ?? "Confirmation Hub"}
            </div>
          </div>
          <div className="whitespace-pre-wrap px-5 py-4 text-sm text-foreground">
            {pending?.message}
          </div>
          <AlertDialogFooter className="border-t bg-muted/30 px-5 py-3">
            <AlertDialogCancel onClick={() => close(false)}>
              {pending?.cancelLabel ?? "Annuler"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={
                pending?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {pending?.confirmLabel ?? "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!prompt}
        onOpenChange={(open) => {
          if (!open) closePrompt(null);
        }}
      >
        <AlertDialogContent className="max-w-md gap-0 overflow-hidden p-0 shadow-2xl">
          <div className="flex items-center gap-3 border-b bg-primary/10 px-5 py-3">
            <HelpCircle className="h-5 w-5 text-primary" />
            <div className="text-sm font-semibold">
              {prompt?.title ?? "Saisir une valeur"}
            </div>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="whitespace-pre-wrap text-sm text-foreground">
              {prompt?.message}
            </div>
            {prompt?.multiline ? (
              <textarea
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={prompt?.placeholder}
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            ) : (
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={prompt?.placeholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") closePrompt(value);
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>
          <AlertDialogFooter className="border-t bg-muted/30 px-5 py-3">
            <AlertDialogCancel onClick={() => closePrompt(null)}>
              {prompt?.cancelLabel ?? "Annuler"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => closePrompt(value)}>
              {prompt?.confirmLabel ?? "Valider"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
