import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
 * Returns a Promise<boolean>. Falls back to native confirm() during SSR.
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

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(currentPending);

  useEffect(() => {
    const l = (p: Pending | null) => setPending(p);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const close = (result: boolean) => {
    if (pending) pending.resolve(result);
    emit(null);
  };

  return (
    <AlertDialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending?.title ?? "Confirmation"}
          </AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap text-left">
            {pending?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
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
  );
}
