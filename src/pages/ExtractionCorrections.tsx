import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

const ExtractionCorrections = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [newParam, setNewParam] = useState("");
  const [newField, setNewField] = useState("parameter_name");
  const [newOriginal, setNewOriginal] = useState("");
  const [newCorrected, setNewCorrected] = useState("");
  const queryClient = useQueryClient();

  const { data: corrections = [], isLoading } = useQuery({
    queryKey: ["extraction-corrections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_corrections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("extraction_corrections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "Correction deleted" });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("extraction_corrections").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "All corrections cleared" });
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("extraction_corrections").insert({
        parameter_name: newParam,
        field_corrected: newField,
        original_value: newOriginal || null,
        corrected_value: newCorrected || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "Correction added" });
      setAddOpen(false);
      setNewParam("");
      setNewField("parameter_name");
      setNewOriginal("");
      setNewCorrected("");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Extraction Corrections</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Correction
          </Button>
          {corrections.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => clearAllMutation.mutate()} disabled={clearAllMutation.isPending}>
              Clear All
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        These corrections are fed into the AI prompt to improve future extractions. Total: {corrections.length}
      </p>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Manual Correction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Parameter Name</Label>
              <Input value={newParam} onChange={(e) => setNewParam(e.target.value)} placeholder="e.g. Abs Eosinophil" />
            </div>
            <div>
              <Label>Field Corrected</Label>
              <Select value={newField} onValueChange={setNewField}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="parameter_name">Parameter Name</SelectItem>
                  <SelectItem value="result_value">Result Value</SelectItem>
                  <SelectItem value="unit">Unit</SelectItem>
                  <SelectItem value="normal_range_low">Normal Range Low</SelectItem>
                  <SelectItem value="normal_range_high">Normal Range High</SelectItem>
                  <SelectItem value="normal_range_text">Normal Range Text</SelectItem>
                  <SelectItem value="flag">Flag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Original Value (what AI extracted)</Label>
              <Input value={newOriginal} onChange={(e) => setNewOriginal(e.target.value)} placeholder="e.g. Abs Eosinophils" />
            </div>
            <div>
              <Label>Corrected Value</Label>
              <Input value={newCorrected} onChange={(e) => setNewCorrected(e.target.value)} placeholder="e.g. Abs Eosinophil" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!newParam || addMutation.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logged Corrections</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Original</TableHead>
                    <TableHead>Corrected</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corrections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.parameter_name}</TableCell>
                      <TableCell>{c.field_corrected}</TableCell>
                      <TableCell className="text-destructive">{c.original_value || "—"}</TableCell>
                      <TableCell className="text-green-600 dark:text-green-400">{c.corrected_value || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(c.created_at), "dd MMM yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExtractionCorrections;
