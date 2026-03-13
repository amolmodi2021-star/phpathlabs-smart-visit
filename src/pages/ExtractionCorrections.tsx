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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Extraction Corrections</h1>
        {corrections.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => clearAllMutation.mutate()} disabled={clearAllMutation.isPending}>
            Clear All
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        These corrections are fed into the AI prompt to improve future extractions. Total: {corrections.length}
      </p>

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
