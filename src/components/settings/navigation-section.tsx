import { useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, RotateCcw, LayoutDashboard, Inbox, CheckSquare, Calendar, Users, ClipboardList, Lock, CalendarClock, FolderOpen, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavOrder } from "@/lib/use-nav-order";

const NAV_ITEMS: Record<string, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  "/dashboard": { title: "Dashboard", icon: LayoutDashboard },
  "/inbox": { title: "Inbox", icon: Inbox },
  "/secure-box": { title: "Coffre sécurisé", icon: Lock },
  "/tasks": { title: "Tâches", icon: CheckSquare },
  "/calendar": { title: "Agenda", icon: Calendar },
  "/meetings": { title: "Réunions", icon: CalendarClock },
  "/documents": { title: "Documents", icon: FolderOpen },
  "/contacts": { title: "Contacts", icon: Users },
  "/plan-operation": { title: "Plan d'opération", icon: ClipboardList },
  "/stats": { title: "Stats", icon: BarChart3 },
};

const DEFAULT_ORDER = Object.keys(NAV_ITEMS);

function SortableRow({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const item = NAV_ITEMS[id];
  if (!item) return null;
  const Icon = item.icon;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-card p-3 shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Déplacer"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium">{item.title}</span>
      <span className="ml-auto text-xs text-muted-foreground">{id}</span>
    </div>
  );
}

export function NavigationSection() {
  const defaults = useMemo(() => DEFAULT_ORDER, []);
  const { order, setOrder, reset } = useNavOrder(defaults);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrder(arrayMove(order, oldIndex, newIndex));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Ordre du menu Navigation</CardTitle>
            <CardDescription>
              Glissez les dossiers de haut en bas pour réorganiser la colonne Navigation (Inbox, Coffre, Tâches, Agenda…).
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Réinitialiser
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {order.map((id) => (
                <SortableRow key={id} id={id} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}
