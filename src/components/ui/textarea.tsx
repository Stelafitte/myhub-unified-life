import * as React from "react";

import { cn } from "@/lib/utils";
import { MicButton } from "@/components/ui/mic-button";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** Désactive le bouton de dictée vocale (activé par défaut sur toutes les textareas). */
  noMic?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, noMic, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    const ta = (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          !noMic && "pr-9",
          className,
        )}
        ref={innerRef}
        {...props}
      />
    );

    if (noMic || props.disabled || props.readOnly) return ta;

    return (
      <div className="relative w-full">
        {ta}
        <MicButton
          targetRef={innerRef}
          className="absolute bottom-1.5 right-1.5"
          iconSize={14}
        />
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
