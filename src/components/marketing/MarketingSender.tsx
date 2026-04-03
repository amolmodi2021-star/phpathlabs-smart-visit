import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseExcelFile } from "@/lib/excel";

interface Variable {
  name: string;
  description: string;
}

const MarketingSender = () => {
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [excelData, setExcelData] = useState<Record<string, unknown>[]>([]);
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [mobileColumn, setMobileColumn] = useState("");
  const [delayMs, setDelayMs] = useState(3000);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const { data: templates = [] } = useQuery({
    queryKey: ["marketing_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketing_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const selectedTemplate = templates.find((t: any) => t.id === selectedTemplateId);
  const templateVariables: Variable[] = selectedTemplate && Array.isArray(selectedTemplate.variables) ? (selectedTemplate.variables as any as Variable[]) : [];
  const excelColumns = excelData.length > 0 ? Object.keys(excelData[0]) : [];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await parseExcelFile(file);
      setExcelData(data);
      setVariableMapping({});
      setMobileColumn("");
      toast.success(`Loaded ${data.length} rows`);
    } catch {
      toast.error("Failed to parse Excel file");
    }
  };

  const getApiSettings = async () => {
    // Use per-template settings if available, fallback to global
    if (selectedTemplate?.api_base_url && selectedTemplate?.api_key) {
      return {
        whatsapp_api_url: selectedTemplate.api_base_url,
        whatsapp_api_key: selectedTemplate.api_key,
        whatsapp_auth_header_name: selectedTemplate.auth_header_name || "apikey",
        whatsapp_auth_prefix: selectedTemplate.auth_header_prefix || "",
        whatsapp_from_number: selectedTemplate.from_number || "",
      };
    }
    // Fallback to global settings
    const { data } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["whatsapp_api_url", "whatsapp_api_key", "whatsapp_auth_header_name", "whatsapp_auth_prefix", "whatsapp_from_number"]);
    const map: Record<string, string> = {};
    data?.forEach((r: any) => { map[r.setting_key] = r.setting_value; });
    return map;
  };

  const sendMessages = async () => {
    if (!selectedTemplate || excelData.length === 0 || !mobileColumn) {
      toast.error("Select template, upload data, and map mobile column");
      return;
    }

    const settings = await getApiSettings();
    const apiUrl = settings.whatsapp_api_url;
    const apiKey = settings.whatsapp_api_key;
    const headerName = settings.whatsapp_auth_header_name || "apikey";
    const headerPrefix = settings.whatsapp_auth_prefix || "";
    const fromNumber = settings.whatsapp_from_number || "";

    if (!apiUrl || !apiKey) {
      toast.error("WhatsApp API settings not configured. Configure in Loyalty Cards → WhatsApp API Settings.");
      return;
    }

    // Create campaign record
    const { data: campaign, error: campErr } = await supabase.from("marketing_campaigns").insert({
      template_id: selectedTemplateId,
      excel_data: excelData as any,
      variable_mapping: variableMapping as any,
      total_messages: excelData.length,
      delay_ms: delayMs,
      status: "sending",
    }).select().single();

    if (campErr || !campaign) {
      toast.error("Failed to create campaign");
      return;
    }

    setSending(true);
    setProgress({ current: 0, total: excelData.length });
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rawMobile = String(row[mobileColumn] || "").replace(/\D/g, "");
      // Always ensure +91 prefix: strip country code if present, take last 10 digits
      const mobile10 = rawMobile.slice(-10);
      const phone = `+91${mobile10}`;

      const params = templateVariables.map((_, idx) => {
        const col = variableMapping[String(idx)];
        return col ? String(row[col] || "") : "";
      });

      const payload: any = {
        from: fromNumber,
        to: phone,
        templateName: selectedTemplate.whatsapp_template_name,
        campaignName: selectedTemplate.template_name || "",
        type: "template",
        components: {},
      };

      if (params.length > 0) {
        payload.components.body = {
          params,
        };
      }

      try {
        const { data: proxyResp, error: proxyErr } = await supabase.functions.invoke("send-marketing-message", {
          body: {
            apiUrl,
            apiKey,
            headerName,
            headerPrefix,
            payload,
          },
        });
        if (proxyErr || !proxyResp || proxyResp.status < 200 || proxyResp.status >= 300) {
          failedCount++;
        } else {
          sentCount++;
        }
      } catch {
        failedCount++;
      }

      setProgress({ current: i + 1, total: excelData.length });

      if (i < excelData.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    await supabase.from("marketing_campaigns").update({
      sent_count: sentCount,
      failed_count: failedCount,
      status: failedCount === 0 ? "completed" : "completed_with_errors",
    }).eq("id", campaign.id);

    setSending(false);
    queryClient.invalidateQueries({ queryKey: ["marketing_campaigns"] });
    toast.success(`Sent: ${sentCount}, Failed: ${failedCount}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send WhatsApp Template Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Template Selection */}
          <div>
            <Label>Select Template</Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Show template info */}
          {selectedTemplate && (
            <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
              <p className="font-medium">WhatsApp API Template: <span className="font-mono text-primary">{selectedTemplate.whatsapp_template_name}</span></p>
              {selectedTemplate.api_base_url ? (
                <p className="text-xs text-muted-foreground">Using custom API settings (From: {selectedTemplate.from_number || "not set"})</p>
              ) : (
                <p className="text-xs text-muted-foreground">Using global API settings</p>
              )}
              {templateVariables.length > 0 ? (
                <>
                  <p className="font-medium mt-2">Body Variables Required ({templateVariables.length}):</p>
                  {templateVariables.map((v, i) => (
                    <p key={i} className="text-muted-foreground">{`{{${i + 1}}} - ${v.name}`}{v.description ? ` (${v.description})` : ""}</p>
                  ))}
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No body variables defined for this template</p>
              )}
            </div>
          )}

          {/* Excel Upload */}
          <div>
            <Label>Upload Excel File</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
              {excelData.length > 0 && (
                <span className="text-sm text-muted-foreground whitespace-nowrap">{excelData.length} rows</span>
              )}
            </div>
          </div>

          {/* Column Mapping */}
          {excelData.length > 0 && (
            <div className="space-y-3">
              <div>
                <Label>Mobile Number Column</Label>
                <Select value={mobileColumn} onValueChange={setMobileColumn}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mobile column" />
                  </SelectTrigger>
                  <SelectContent>
                    {excelColumns.map((col) => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {templateVariables.map((v, idx) => (
                <div key={idx}>
                  <Label>{`{{${idx + 1}}} ${v.name}`}</Label>
                  <Select value={variableMapping[String(idx)] || ""} onValueChange={(val) => setVariableMapping({ ...variableMapping, [String(idx)]: val })}>
                    <SelectTrigger>
                      <SelectValue placeholder={`Map to Excel column`} />
                    </SelectTrigger>
                    <SelectContent>
                      {excelColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {/* Delay */}
          <div>
            <Label>Delay Between Messages (ms)</Label>
            <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} min={1000} step={500} />
          </div>

          {/* Preview */}
          {excelData.length > 0 && (
            <div className="max-h-48 overflow-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    {excelColumns.slice(0, 6).map((col) => (
                      <TableHead key={col} className="text-xs">{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {excelData.slice(0, 5).map((row, i) => (
                    <TableRow key={i}>
                      {excelColumns.slice(0, 6).map((col) => (
                        <TableCell key={col} className="text-xs">{String(row[col] || "")}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {excelData.length > 5 && <p className="text-xs text-center text-muted-foreground py-1">...and {excelData.length - 5} more rows</p>}
            </div>
          )}

          {/* Progress */}
          {sending && (
            <div className="space-y-2">
              <Progress value={(progress.current / progress.total) * 100} />
              <p className="text-sm text-center text-muted-foreground">{progress.current} / {progress.total}</p>
            </div>
          )}

          <Button className="w-full" onClick={sendMessages} disabled={sending || !selectedTemplateId || excelData.length === 0}>
            {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</> : <><Send className="h-4 w-4 mr-2" /> Send Messages</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default MarketingSender;
