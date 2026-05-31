import { useRef, useState, type ReactNode, type TouchEvent } from "react";
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
const TRIGGER_RATIO = 0.5; // swipe past 50% of total actions width to auto-trigger first action

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
  const dragging = useRef(false);
  const decided = useRef<"h" | "v" | null>(null);

  const leftW = leftActions.length * ACTION_W;
  const rightW = rightActions.length * ACTION_W;

  const onTouchStart = (e: TouchEvent) => {
    if (!enabled) return;
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    dragging.current = true;
    decided.current = null;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!enabled || !dragging.current) return;
    const t = e.touches[0];
    const dX = t.clientX - startX.current;
    const dY = t.clientY - startY.current;
    if (decided.current === null) {
      // Wait for a clear gesture before committing
      if (Math.abs(dX) < 12 && Math.abs(dY) < 12) return;
      if (Math.abs(dX) < Math.abs(dY) * 1.2) {
        // vertical scroll wins; abort and do not translate
        decided.current = "v";
        dragging.current = false;
        return;
      }
      decided.current = "h";
      setIsDragging(true);
    }
    if (decided.current !== "h") return;
    const base = open === "left" ? leftW : open === "right" ? -rightW : 0;
    let next = base + dX;
    // clamp
    if (next > leftW) next = leftW + (next - leftW) * 0.2;
    if (next < -rightW) next = -rightW + (next + rightW) * 0.2;
    if (leftActions.length === 0 && next > 0) next = next * 0.2;
    if (rightActions.length === 0 && next < 0) next = next * 0.2;
    setDx(next);
  };
  const onTouchEnd = () => {
    if (!enabled) return;
    dragging.current = false;
    setIsDragging(false);
    if (decided.current !== "h") return;
    const triggerLeft = leftW * TRIGGER_RATIO;
    const triggerRight = rightW * TRIGGER_RATIO;
    if (dx >= leftW + 40 && leftActions[0]) {
      leftActions[0].onAction();
      setDx(0);
      setOpen(0);
    } else if (dx <= -(rightW + 40) && rightActions[0]) {
      rightActions[0].onAction();
      setDx(0);
      setOpen(0);
    } else if (dx > triggerLeft && leftActions.length) {
      setDx(leftW);
      setOpen("left");
    } else if (dx < -triggerRight && rightActions.length) {
      setDx(-rightW);
      setOpen("right");
    } else {
      setDx(0);
      setOpen(0);
    }
  };

  const close = () => {
    setDx(0);
    setOpen(0);
  };

  const showLeft = dx > 0;
  const showRight = dx < 0;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Left actions (revealed when swiping right) */}
      {leftActions.length > 0 && (
        <div className="absolute inset-y-0 left-0 flex" style={{ width: leftW }}>
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
      {/* Right actions (revealed when swiping left) */}
      {rightActions.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: rightW }}>
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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: dragging.current ? "none" : "transform 180ms ease-out",
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
}
