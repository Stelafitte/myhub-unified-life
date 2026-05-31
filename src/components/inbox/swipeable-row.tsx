import { useRef, useState, type ReactNode, type PointerEvent, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export type SwipeAction = {
  key: string;
  label: string;
  icon: ReactNode;
  color: string; // tailwind bg class
  onAction: () => void;
};

type Props = {
  leftActions?: SwipeAction[]; // revealed when swiping right (shown on the left)
  rightActions?: SwipeAction[]; // revealed when swiping left (shown on the right)
  enabled?: boolean;
  children: ReactNode;
  className?: string;
};

const ACTION_W = 72; // px per action button
const TRIGGER_RATIO = 0.5;

export function SwipeableRow({
  leftActions = [],
  rightActions = [],
  enabled = true,
  children,
  className,
}: Props) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState<0 | "left" | "right">(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const pointerId = useRef<number | null>(null);
  const decided = useRef<"h" | "v" | null>(null);
  const dxRef = useRef(0);
  const suppressClick = useRef(false);

  const leftW = leftActions.length * ACTION_W;
  const rightW = rightActions.length * ACTION_W;

  const setTranslate = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled) return;
    // Ignore secondary buttons (mouse right click etc.)
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    pointerId.current = e.pointerId;
    decided.current = null;
    suppressClick.current = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!enabled || pointerId.current !== e.pointerId) return;
    const dX = e.clientX - startX.current;
    const dY = e.clientY - startY.current;
    if (decided.current === null) {
      if (Math.abs(dX) < 12 && Math.abs(dY) < 12) return;
      if (Math.abs(dX) < Math.abs(dY) * 1.2) {
        decided.current = "v";
        pointerId.current = null;
        return;
      }
      decided.current = "h";
      suppressClick.current = true;
      setIsDragging(true);
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        return;
      }
    }
    if (decided.current !== "h") return;
    e.preventDefault();
    const base = open === "left" ? leftW : open === "right" ? -rightW : 0;
    let next = base + dX;
    if (next > leftW) next = leftW + (next - leftW) * 0.2;
    if (next < -rightW) next = -rightW + (next + rightW) * 0.2;
    if (leftActions.length === 0 && next > 0) next = next * 0.2;
    if (rightActions.length === 0 && next < 0) next = next * 0.2;
    setTranslate(next);
  };

  const finish = () => {
    pointerId.current = null;
    setIsDragging(false);
    if (decided.current !== "h") return;
    const triggerLeft = leftW * TRIGGER_RATIO;
    const triggerRight = rightW * TRIGGER_RATIO;
    const cur = dxRef.current;
    if (cur >= leftW + 40 && leftActions[0]) {
      leftActions[0].onAction();
      setTranslate(0);
      setOpen(0);
    } else if (cur <= -(rightW + 40) && rightActions[0]) {
      rightActions[0].onAction();
      setTranslate(0);
      setOpen(0);
    } else if (cur > triggerLeft && leftActions.length) {
      setTranslate(leftW);
      setOpen("left");
    } else if (cur < -triggerRight && rightActions.length) {
      setTranslate(-rightW);
      setOpen("right");
    } else {
      setTranslate(0);
      setOpen(0);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    finish();
  };

  const onClickCapture = (e: MouseEvent) => {
    if (!suppressClick.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick.current = false;
  };

  const close = () => {
    setTranslate(0);
    setOpen(0);
  };

  const showLeft = dx > 0;
  const showRight = dx < 0;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {leftActions.length > 0 && (
        <div
          className="absolute inset-y-0 left-0 flex"
          style={{ width: leftW, visibility: showLeft ? "visible" : "hidden" }}
        >
          {leftActions.map((a) => (
            <button
              key={a.key}
              onClick={(e) => {
                e.stopPropagation();
                a.onAction();
                close();
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-white",
                a.color,
              )}
              style={{ width: ACTION_W }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {rightActions.length > 0 && (
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ width: rightW, visibility: showRight ? "visible" : "hidden" }}
        >
          {rightActions.map((a) => (
            <button
              key={a.key}
              onClick={(e) => {
                e.stopPropagation();
                a.onAction();
                close();
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-white",
                a.color,
              )}
              style={{ width: ACTION_W }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: isDragging ? "none" : "transform 180ms ease-out",
          touchAction: "pan-y",
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
}
