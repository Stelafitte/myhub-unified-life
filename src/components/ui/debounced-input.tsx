import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * DebouncedInput / DebouncedTextarea
 *
 * Holds local state for the typed value and only propagates to the parent
 * via `onValueChange` after a short debounce (default 250ms) and on blur.
 * This avoids re-rendering a large parent tree on every keystroke, which
 * is the source of significant typing latency in big dialogs/forms.
 *
 * The external `value` prop seeds the local state and re-syncs only when
 * it changes externally (e.g. when loading an existing record) — not on
 * every parent re-render caused by our own commits.
 */

type DebouncedInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onValueChange: (v: string) => void;
  debounceMs?: number;
};

export const DebouncedInput = React.forwardRef<HTMLInputElement, DebouncedInputProps>(
  ({ value, onValueChange, debounceMs = 250, onBlur, ...rest }, ref) => {
    const [local, setLocal] = React.useState(value);
    const lastExternal = React.useRef(value);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
      if (value !== lastExternal.current) {
        lastExternal.current = value;
        setLocal(value);
      }
    }, [value]);

    React.useEffect(() => () => {
      if (timer.current) clearTimeout(timer.current);
    }, []);

    const commit = React.useCallback(
      (v: string) => {
        lastExternal.current = v;
        onValueChange(v);
      },
      [onValueChange],
    );

    return (
      <Input
        ref={ref}
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), debounceMs);
        }}
        onBlur={(e) => {
          if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
          }
          if (local !== lastExternal.current) commit(local);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
DebouncedInput.displayName = "DebouncedInput";

type DebouncedTextareaProps = Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> & {
  value: string;
  onValueChange: (v: string) => void;
  debounceMs?: number;
};

export const DebouncedTextarea = React.forwardRef<HTMLTextAreaElement, DebouncedTextareaProps>(
  ({ value, onValueChange, debounceMs = 300, onBlur, ...rest }, ref) => {
    const [local, setLocal] = React.useState(value);
    const lastExternal = React.useRef(value);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
      if (value !== lastExternal.current) {
        lastExternal.current = value;
        setLocal(value);
      }
    }, [value]);

    React.useEffect(() => () => {
      if (timer.current) clearTimeout(timer.current);
    }, []);

    const commit = React.useCallback(
      (v: string) => {
        lastExternal.current = v;
        onValueChange(v);
      },
      [onValueChange],
    );

    return (
      <Textarea
        ref={ref}
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), debounceMs);
        }}
        onBlur={(e) => {
          if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
          }
          if (local !== lastExternal.current) commit(local);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
DebouncedTextarea.displayName = "DebouncedTextarea";
