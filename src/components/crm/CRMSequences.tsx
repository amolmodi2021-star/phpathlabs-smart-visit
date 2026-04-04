import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ACTION_TYPES = ["loyalty_card", "abnormal_history", "promotion", "custom"];
const LOCATION_FILTERS = ["ALL", "PH VESU", "NON PHPL"];

const CRMSequences = () => {
  const qc = useQueryClient();
  const [newStep, setNewStep] = useState({ action_type: "loyalty_card", delay_days: 0, filter_location: "ALL" });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["crm-sequence-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_sequence_rules").select("*").order("step_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["marketing-templates-list"],
    queryFn: async () => {
      const { data } = await supabase.from("marketing_templates").select("id, template_name");
      return data || [];
    },
  });

  const addStep = async () => {
    const nextOrder = rules.length > 0 ? Math.max(...rules.map((r: any) => r.step_order)) + 1 : 1;
    const { error } = await supabase.from("crm_sequence_rules").insert({
      step_order: nextOrder,
      action_type: newStep.action_type,
      delay_days: newStep.delay_days,
      filter_location: newStep.filter_location,
    });
    if (error) return toast.error("Failed to add step");
    qc.invalidateQueries({ queryKey: ["crm-sequence-rules"] });
    toast.success("Step added");
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await supabase.from("crm_sequence_rules").update({ enabled }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["crm-sequence-rules"] });
  };

  const deleteStep = async (id: string) => {
    await supabase.from("crm_sequence_rules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["crm-sequence-rules"] });
    toast.success("Step deleted");
  };

  const updateTemplate = async (id: string, templateId: string | null) => {
    await supabase.from("crm_sequence_rules").update({ template_id: templateId }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["crm-sequence-rules"] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Add Sequence Step</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Action</label>
              <Select value={newStep.action_type} onValueChange={(v) => setNewStep({ ...newStep, action_type: v })}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Delay (days)</label>
              <Input type="number" min={0} value={newStep.delay_days} onChange={(e) => setNewStep({ ...newStep, delay_days: parseInt(e.target.value) || 0 })} className="w-24" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Filter</label>
              <Select value={newStep.filter_location} onValueChange={(v) => setNewStep({ ...newStep, filter_location: v })}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>{LOCATION_FILTERS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={addStep}><Plus className="h-4 w-4 mr-1" />Add Step</Button>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Delay (days)</TableHead>
              <TableHead>Filter</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">No sequence rules defined.</TableCell></TableRow>
            ) : rules.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.step_order}</TableCell>
                <TableCell className="capitalize">{r.action_type.replace("_", " ")}</TableCell>
                <TableCell>{r.delay_days}</TableCell>
                <TableCell>{r.filter_location}</TableCell>
                <TableCell>
                  <Select value={r.template_id || "none"} onValueChange={(v) => updateTemplate(r.id, v === "none" ? null : v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r.id, v)} /></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => deleteStep(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CRMSequences;
