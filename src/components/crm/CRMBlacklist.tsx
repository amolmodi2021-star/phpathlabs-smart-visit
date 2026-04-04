import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { Upload, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

const CRMBlacklist = () => {
  const [newNumber, setNewNumber] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["crm-blacklist"],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_blacklist").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const addNumber = async () => {
    const mobile = newNumber.replace(/\D/g, "").slice(-10);
    if (mobile.length !== 10) return toast.error("Enter a valid 10-digit number");
    const { error } = await supabase.from("crm_blacklist").upsert({ mobile_number: mobile }, { onConflict: "mobile_number" });
    if (error) return toast.error("Failed to add");
    setNewNumber("");
    qc.invalidateQueries({ queryKey: ["crm-blacklist"] });
    toast.success("Added to blacklist");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      const numbers = rows.map((r) => {
        const val = String(Object.values(r)[0] || "").replace(/\D/g, "").slice(-10);
        return val.length === 10 ? val : null;
      }).filter(Boolean);
      const unique = [...new Set(numbers)];
      if (!unique.length) return toast.error("No valid numbers found");
      const { error } = await supabase.from("crm_blacklist").upsert(
        unique.map((m) => ({ mobile_number: m! })),
        { onConflict: "mobile_number" }
      );
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["crm-blacklist"] });
      toast.success(`Added ${unique.length} numbers`);
    } catch { toast.error("Import failed"); }
    e.target.value = "";
  };

  const removeDuplicates = async () => {
    toast.info("Duplicates are already prevented by unique constraint");
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const { error } = await supabase.from("crm_blacklist").delete().in("id", ids);
    if (error) return toast.error("Delete failed");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["crm-blacklist"] });
    toast.success(`Deleted ${ids.length} entries`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Enter mobile number" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} className="w-48"
          onKeyDown={(e) => e.key === "Enter" && addNumber()} />
        <Button size="sm" onClick={addNumber}><Plus className="h-4 w-4 mr-1" />Add</Button>
        <label className="cursor-pointer">
          <Button size="sm" variant="outline" asChild><span><Upload className="h-4 w-4 mr-1" />Import Excel</span></Button>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>
        <Button size="sm" variant="outline" onClick={removeDuplicates}>Remove Duplicates</Button>
        {selected.size > 0 && (
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" />Delete ({selected.size})
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">Total: {items.length}</span>
      </div>

      <div className="border rounded-lg overflow-auto max-h-[50vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><Checkbox checked={items.length > 0 && selected.size === items.length} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Mobile Number</TableHead>
              <TableHead>Added On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">No blacklisted numbers.</TableCell></TableRow>
            ) : items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell><Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleSelect(item.id)} /></TableCell>
                <TableCell>{item.mobile_number}</TableCell>
                <TableCell>{new Date(item.created_at).toLocaleDateString("en-GB")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DeletePasswordDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete}
        title="Delete Blacklist Entries" description={`Delete ${selected.size} selected entries?`} />
    </div>
  );
};

export default CRMBlacklist;
