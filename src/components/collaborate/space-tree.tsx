import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Plus, Search, Globe2, Users, Megaphone, Loader2, MoreHorizontal, Trash2, Pencil, FolderPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { getSpaceTree, createSpace, deleteSpace, renameSpace } from "@/lib/collab.functions";

export interface SpaceNode {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  icon: string | null;
  color: string | null;
  type: string | null;
  position: number;
}

interface Props {
  activeSpaceId: string | null;
  onSelect: (id: string | null) => void;
}

export function SpaceTree({ activeSpaceId, onSelect }: Props) {
  const treeFn = useServerFn(getSpaceTree);
  const createFn = useServerFn(createSpace);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["collab-tree"],
    queryFn: () => treeFn(),
  });

  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>("__root__");

  const create = useMutation({
    mutationFn: (vars: { name: string; parentId: string | null }) =>
      createFn({ data: { name: vars.name, parentId: vars.parentId, icon: vars.parentId ? "📁" : "🏷️" } }),
    onSuccess: () => {
      toast.success("Espace créé");
      qc.invalidateQueries({ queryKey: ["collab-tree"] });
      setCreating(false);
      setNewName("");
      setNewParent("__root__");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const spaces = ((data?.spaces ?? []) as SpaceNode[]).filter(
    (s) => !/^wa\s*:/i.test(s.name.trim()),
  );

  const { roots, byParent } = useMemo(() => {
    const filt = filter.trim().toLowerCase();
    const visible = filt
      ? spaces.filter((s) => s.name.toLowerCase().includes(filt))
      : spaces;
    // Si on filtre, on remonte les parents pour garder le contexte
    const ids = new Set(visible.map((s) => s.id));
    if (filt) {
      for (const s of visible) {
        let p = s.parent_id;
        while (p) {
          ids.add(p);
          const parent = spaces.find((x) => x.id === p);
          p = parent?.parent_id ?? null;
        }
      }
    }
    const shown = spaces.filter((s) => ids.has(s.id));
    const byParent: Record<string, SpaceNode[]> = {};
    const roots: SpaceNode[] = [];
    for (const s of shown) {
      if (!s.parent_id) roots.push(s);
      else {
        byParent[s.parent_id] ??= [];
        byParent[s.parent_id].push(s);
      }
    }
    return { roots, byParent };
  }, [spaces, filter]);

  const renderNode = (node: SpaceNode, depth: number) => {
    const children = byParent[node.id] ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed[node.id];
    const isActive = activeSpaceId === node.id;
    return (
      <div key={node.id}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm cursor-pointer hover:bg-accent/60",
            isActive && "bg-accent text-accent-foreground",
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => onSelect(node.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => ({ ...c, [node.id]: !c[node.id] }));
              }}
              className="p-0.5 hover:bg-muted rounded"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")}
              />
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span className="shrink-0">{node.icon ?? "📁"}</span>
          <span className="truncate">{node.name}</span>
        </div>
        {hasChildren && !isCollapsed && children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">🤝 Collaboratif</div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCreating(true)} title="Nouvel espace">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer…"
            className="pl-7 h-8 text-sm"
          />
        </div>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60",
            activeSpaceId === null && "bg-accent text-accent-foreground",
          )}
        >
          <Globe2 className="h-4 w-4" />
          Fil global
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : roots.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">
            Aucun espace. Crée le premier avec +.
          </div>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>

      <div className="border-t px-2 py-2 space-y-1">
        <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60 text-muted-foreground">
          <Users className="h-4 w-4" /> Groupes
        </button>
        <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60 text-muted-foreground">
          <Megaphone className="h-4 w-4" /> Sollicitations
        </button>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel espace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nom</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex : Commission Formation" />
            </div>
            <div>
              <Label>Parent</Label>
              <Select value={newParent} onValueChange={setNewParent}>
                <SelectTrigger>
                  <SelectValue placeholder="Racine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— Racine —</SelectItem>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {"".padStart(s.level * 2, "·")} {s.icon ?? "📁"} {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button
              disabled={!newName.trim() || create.isPending}
              onClick={() =>
                create.mutate({
                  name: newName.trim(),
                  parentId: newParent === "__root__" ? null : newParent,
                })
              }
            >
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
