import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";

interface Variable {
  name: string;
  description: string;
}

const MarketingTemplates = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [whatsappTemplateName, setWhatsappTemplateName] = useState("");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [newVarName, setNewVarName] = useState("");
  const [newVarDesc, setNewVarDesc] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ["marketing_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const resetForm = () => {
    setEditId(null);
    setTemplateName("");
    setWhatsappTemplateName("");
    setVariables([]);
    setNewVarName("");
    setNewVarDesc("");
  };

  const addVariable = () => {
    if (!newVarName.trim()) return;
    setVariables([...variables, { name: newVarName.trim(), description: newVarDesc.trim() }]);
    setNewVarName("");
    setNewVarDesc("");
  };

  const removeVariable = (idx: number) => {
    setVariables(variables.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!templateName.trim() || !whatsappTemplateName.trim()) {
      toast.error("Template name and WhatsApp template name are required");
      return;
    }

    const payload = {
      template_name: templateName.trim(),
      whatsapp_template_name: whatsappTemplateName.trim(),
      variables: variables as any,
    };

    if (editId) {
      const { error } = await supabase.from("marketing_templates").update(payload).eq("id", editId);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Template updated");
    } else {
      const { error } = await supabase.from("marketing_templates").insert(payload);
      if (error) { toast.error("Failed to save"); return; }
      toast.success("Template saved");
    }

    queryClient.invalidateQueries({ queryKey: ["marketing_templates"] });
    resetForm();
    setOpen(false);
  };

  const handleEdit = (t: any) => {
    setEditId(t.id);
    setTemplateName(t.template_name);
    setWhatsappTemplateName(t.whatsapp_template_name);
    setVariables(Array.isArray(t.variables) ? t.variables : []);
    setOpen(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("marketing_templates").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Template deleted");
    queryClient.invalidateQueries({ queryKey: ["marketing_templates"] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>WhatsApp Templates</CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Template</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit" : "Add"} Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Template Display Name</Label>
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Festival Offer" />
              </div>
              <div>
                <Label>WhatsApp API Template Name</Label>
                <Input value={whatsappTemplateName} onChange={(e) => setWhatsappTemplateName(e.target.value)} placeholder="e.g. festival_offer_v1" />
              </div>

              <div className="space-y-2">
                <Label>Template Variables</Label>
                {variables.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-muted p-2 rounded">
                    <span className="font-medium">{`{{${i + 1}}}`}</span>
                    <span className="flex-1">{v.name}</span>
                    <span className="text-muted-foreground text-xs">{v.description}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeVariable(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newVarName} onChange={(e) => setNewVarName(e.target.value)} placeholder="Variable name" className="flex-1" />
                  <Input value={newVarDesc} onChange={(e) => setNewVarDesc(e.target.value)} placeholder="Description (optional)" className="flex-1" />
                  <Button variant="outline" size="sm" onClick={addVariable}>Add</Button>
                </div>
              </div>

              <Button className="w-full" onClick={handleSave}>
                {editId ? "Update" : "Save"} Template
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No templates yet. Add one to get started.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>WhatsApp Template</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.template_name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.whatsapp_template_name}</TableCell>
                  <TableCell>
                    {(Array.isArray(t.variables) ? t.variables : []).map((v: Variable, i: number) => (
                      <span key={i} className="inline-block bg-muted text-xs px-1.5 py-0.5 rounded mr-1 mb-1">{`{{${i + 1}}} ${v.name}`}</span>
                    ))}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(t)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default MarketingTemplates;
