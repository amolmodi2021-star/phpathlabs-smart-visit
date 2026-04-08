import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Loader2, Search, GripVertical, Heading2 } from "lucide-react";
import { toast } from "sonner";
import {
  getTestParameters,
  linkParameterToTest,
  unlinkParameterFromTest,
  searchParameters,
  addSubheaderToTest,
  updateSubheaderText,
  reorderTestParameters,
  TestParameterLink,
} from "@/lib/tests";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  testId: string;
  testName: string;
}

/* ── Sortable row component ── */
function SortableRow({
  item,
  onUnlink,
  onSubheaderChange,
}: {
  item: TestParameterLink;
  onUnlink: (id: string) => void;
  onSubheaderChange: (id: string, text: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  if (item.is_subheader) {
    return (
      <TableRow ref={setNodeRef} style={style} className="bg-muted/60">
        <TableCell>
          <button {...attributes} {...listeners} className="cursor-grab touch-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </TableCell>
        <TableCell colSpan={3}>
          <Input
            className="font-semibold text-sm h-8 bg-transparent border-dashed"
            value={item.subheader_text || ""}
            onChange={(e) => onSubheaderChange(item.id, e.target.value)}
            onBlur={(e) => {
              if (e.target.value.trim()) {
                updateSubheaderText(item.id, e.target.value.trim()).catch(() =>
                  toast.error("Failed to save sub-header")
                );
              }
            }}
            placeholder="Enter sub-header text…"
          />
        </TableCell>
        <TableCell className="text-right">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => onUnlink(item.id)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell>
        <button {...attributes} {...listeners} className="cursor-grab touch-none">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </TableCell>
      <TableCell className="font-mono text-xs">{item.param_code}</TableCell>
      <TableCell className="font-medium text-sm">{item.parameter_name}</TableCell>
      <TableCell className="text-sm">{item.unit || "-"}</TableCell>
      <TableCell className="text-right">
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => onUnlink(item.id)}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/* ── Main component ── */
const TestParameterManager = ({ testId, testName }: Props) => {
  const [links, setLinks] = useState<TestParameterLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLinks(await getTestParameters(testId));
    } catch (e: any) {
      toast.error("Failed to load parameters: " + e.message);
    }
    setLoading(false);
  }, [testId]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const results = await searchParameters(q);
      const linkedIds = new Set(links.filter((l) => !l.is_subheader).map((l) => l.parameter_id));
      setSearchResults(results.filter((r: any) => !linkedIds.has(r.id)));
    } catch (e: any) { toast.error(e.message); }
    setSearching(false);
  };

  const handleLink = async (paramId: string) => {
    try {
      const nextOrder = links.length > 0 ? Math.max(...links.map((l) => l.display_order)) + 1 : 0;
      await linkParameterToTest(testId, paramId, nextOrder);
      setSearchQuery(""); setSearchResults([]);
      await load();
      toast.success("Parameter linked");
    } catch (e: any) { toast.error("Link failed: " + e.message); }
  };

  const handleUnlink = async (linkId: string) => {
    try {
      await unlinkParameterFromTest(linkId);
      await load();
      toast.success("Removed");
    } catch (e: any) { toast.error("Remove failed: " + e.message); }
  };

  const handleAddSubheader = async () => {
    try {
      const nextOrder = links.length > 0 ? Math.max(...links.map((l) => l.display_order)) + 1 : 0;
      await addSubheaderToTest(testId, "New Section", nextOrder);
      await load();
      toast.success("Sub-header added");
    } catch (e: any) { toast.error("Failed: " + e.message); }
  };

  const handleSubheaderChange = (id: string, text: string) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, subheader_text: text } : l)));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = links.findIndex((l) => l.id === active.id);
    const newIndex = links.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(links, oldIndex, newIndex).map((l, i) => ({ ...l, display_order: i }));
    setLinks(reordered);
    try {
      await reorderTestParameters(reordered.map((l) => ({ id: l.id, display_order: l.display_order })));
    } catch (e: any) { toast.error("Reorder failed: " + e.message); }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="font-semibold text-sm">Linked Parameters ({links.filter((l) => !l.is_subheader).length})</Label>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={handleAddSubheader}>
            <Heading2 className="h-3.5 w-3.5 mr-1" /> Add Sub-Header
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowSearch(!showSearch)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Parameter
          </Button>
        </div>
      </div>

      {showSearch && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search parameters by name..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} autoFocus />
          </div>
          {searching && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin" /></div>}
          {searchResults.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {searchResults.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm" onClick={() => handleLink(r.id)}>
                  <div>
                    <span className="font-medium">{r.parameter_name}</span>
                    <span className="ml-2 text-xs text-muted-foreground font-mono">{r.param_code}</span>
                    {r.unit && <span className="ml-2 text-xs text-muted-foreground">({r.unit})</span>}
                  </div>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No matching parameters found</p>
          )}
        </div>
      )}

      {links.length > 0 ? (
        <div className="overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="w-[60px] text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {links.map((l) => (
                    <SortableRow key={l.id} item={l} onUnlink={handleUnlink} onSubheaderChange={handleSubheaderChange} />
                  ))}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">
          No parameters linked. Use "Add Parameter" to search and link from master list.
        </p>
      )}
    </div>
  );
};

export default TestParameterManager;
