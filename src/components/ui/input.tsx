import * as React from "react";

import { cn } from "@/lib/utils";
import { MicButton } from "@/components/ui/mic-button";

export interface InputProps extends React.ComponentProps<"input"> {
  /** Affiche un bouton de dictée vocale à droite du champ. */
  withMic?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, withMic, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    const noMicTypes = new Set(["password", "email", "url", "number", "tel", "date", "time", "datetime-local", "file", "color", "checkbox", "radio", "range"]);
    const micEnabled = withMic && !props.disabled && !props.readOnly && !noMicTypes.has(type ?? "");

    const input = (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          micEnabled && "pr-9",
          className,
        )}
        ref={innerRef}
        {...props}
      />
    );

    if (!micEnabled) return input;

    return (
      <div className="relative w-full">
        {input}
        <MicButton
          targetRef={innerRef}
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          iconSize={14}
        />
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
