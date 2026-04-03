import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, Edit2, Settings, Eye, EyeOff, ChevronDown } from "lucide-react";
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

  // API settings per template
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("apikey");
  const [authHeaderPrefix, setAuthHeaderPrefix] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [bodyMapping, setBodyMapping] = useState("");

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
    setApiBaseUrl("");
    setApiKey("");
    setAuthHeaderName("apikey");
    setAuthHeaderPrefix("");
    setFromNumber("");
    setShowApiKey(false);
    setApiSettingsOpen(false);
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
      api_base_url: apiBaseUrl.trim() || null,
      api_key: apiKey.trim() || null,
      auth_header_name: authHeaderName.trim() || "apikey",
      auth_header_prefix: authHeaderPrefix.trim() || "",
      from_number: fromNumber.trim() || null,
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
    setApiBaseUrl(t.api_base_url || "");
    setApiKey(t.api_key || "");
    setAuthHeaderName(t.auth_header_name || "apikey");
    setAuthHeaderPrefix(t.auth_header_prefix || "");
    setFromNumber(t.from_number || "");
    setApiSettingsOpen(!!t.api_base_url || !!t.api_key);
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
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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

              {/* WhatsApp API Settings */}
              <Collapsible open={apiSettingsOpen} onOpenChange={setApiSettingsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between" type="button">
                    <span className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      WhatsApp API Settings
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${apiSettingsOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  <div>
                    <Label className="text-xs">API Base URL</Label>
                    <Input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">API Key</Label>
                    <div className="relative">
                      <Input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
                      <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Auth Header Name</Label>
                      <Input value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Auth Header Prefix</Label>
                      <Input value={authHeaderPrefix} onChange={(e) => setAuthHeaderPrefix(e.target.value)} placeholder="Bearer / empty" className="h-8" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">From Number</Label>
                    <Input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Body Variable Mapping</Label>
                    <Input value={bodyMapping} onChange={(e) => setBodyMapping(e.target.value)} placeholder="e.g. {{1}},{{2}},{{3}}" className="h-8" />
                    <p className="text-xs text-muted-foreground mt-1">Comma-separated body parameters matching template variables above</p>
                  </div>
                  <p className="text-xs text-muted-foreground">If left empty, global settings from Loyalty Cards will be used as fallback.</p>
                </CollapsibleContent>
              </Collapsible>

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
                <TableHead>API</TableHead>
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
                    {t.api_base_url ? (
                      <span className="inline-block bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded">Custom</span>
                    ) : (
                      <span className="inline-block bg-muted text-xs px-1.5 py-0.5 rounded text-muted-foreground">Global</span>
                    )}
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
