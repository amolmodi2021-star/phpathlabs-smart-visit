import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { key: "unit", label: "Units", placeholder: "e.g. mg/dL, g/L, mmol/L" },
  { key: "machine_name", label: "Machine Names", placeholder: "e.g. Sysmex XN-1000" },
  { key: "machine_id", label: "Machine IDs", placeholder: "e.g. MACH001" },
  { key: "outsource_lab", label: "Outsource Labs", placeholder: "e.g. SRL Diagnostics" },
  { key: "method", label: "Methods", placeholder: "e.g. Immunoturbidimetry" },
  { key: "sample_type", label: "Sample Types", placeholder: "e.g. Serum, EDTA Blood" },
  { key: "sample_tube", label: "Sample Tubes", placeholder: "e.g. Red Top, Lavender" },
];

interface LookupItem {
  id: string;
  category: string;
  value: string;
  display_order: number;
  is_active: boolean;
}

function CategorySection({ category, placeholder }: { category: string; placeholder: string }) {
  const qc = useQueryClient();
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["master_lookup", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_lookup")
        .select("*")
        .eq("category", category)
        .order("display_order")
        .order("value");
      if (error) throw error;
      return (data || []) as LookupItem[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.from("master_lookup").insert({
        category,
        value: value.trim(),
        display_order: items.length,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master_lookup", category] });
      setNewValue("");
      toast.success("Added");
    },
    onError: (e: any) => toast.error(e.message?.includes("duplicate") ? "Already exists" : e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const { error } = await supabase.from("master_lookup").update({ value: value.trim() } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master_lookup", category] });
      setEditingId(null);
      toast.success("Updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("master_lookup").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master_lookup", category] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleAdd = () => {
    if (!newValue.trim()) return;
    addMutation.mutate(newValue);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          className="flex-1"
        />
        <Button size="sm" onClick={handleAdd} disabled={!newValue.trim() || addMutation.isPending}>
          <Plus className="h-4 w-4 mr-1" />Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items added yet. Add your first one above.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div key={item.id}>
              {editingId === item.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="h-8 w-40 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") updateMutation.mutate({ id: item.id, value: editValue });
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateMutation.mutate({ id: item.id, value: editValue })}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary" className="gap-1.5 py-1.5 px-3 text-sm cursor-default group">
                  {item.value}
                  <button
                    onClick={() => { setEditingId(item.id); setEditValue(item.value); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(item.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</p>
    </div>
  );
}

export default function MasterLookupSettings() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Settings — Master Lists</h2>
      <p className="text-sm text-muted-foreground">
        Manage dropdown options used across Tests, Parameters, and Profiles. Keep your data clean and consistent.
      </p>
      <Tabs defaultValue="unit" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.key} value={c.key} className="text-xs">
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CATEGORIES.map((c) => (
          <TabsContent key={c.key} value={c.key}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{c.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <CategorySection category={c.key} placeholder={c.placeholder} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
