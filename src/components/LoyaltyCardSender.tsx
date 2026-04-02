import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, Play, Loader2, Eye, EyeOff, Send, Settings } from "lucide-react";
import { parseExcelFile } from "@/lib/excel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const LoyaltyCardSender = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [excelData, setExcelData] = useState<Record<string, unknown>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(3000);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 });

  // WhatsApp API Settings (persisted in localStorage)
  const [waBaseUrl, setWaBaseUrl] = useState(() => localStorage.getItem("loyalty_wa_baseUrl") || "https://api.aoc-portal.com/v1/whatsapp");
  const [waApiKey, setWaApiKey] = useState(() => localStorage.getItem("loyalty_wa_apiKey") || "");
  const [waAuthHeaderName, setWaAuthHeaderName] = useState(() => localStorage.getItem("loyalty_wa_authHeaderName") || "apikey");
  const [waAuthHeaderPrefix, setWaAuthHeaderPrefix] = useState(() => localStorage.getItem("loyalty_wa_authHeaderPrefix") || "");
  const [waFromNumber, setWaFromNumber] = useState(() => localStorage.getItem("loyalty_wa_fromNumber") || "");
  const [waCampaignName, setWaCampaignName] = useState(() => localStorage.getItem("loyalty_wa_campaignName") || "");
  const [waTemplateName, setWaTemplateName] = useState(() => localStorage.getItem("loyalty_wa_templateName") || "");
  const [waBodyMapping, setWaBodyMapping] = useState(() => localStorage.getItem("loyalty_wa_bodyMapping") || '{"1":"Name","2":"Discount %"}');
  const [waMediaHeader, setWaMediaHeader] = useState(() => localStorage.getItem("loyalty_wa_mediaHeader") !== "false");
  const [showApiKey, setShowApiKey] = useState(false);
  const [waSettingsOpen, setWaSettingsOpen] = useState(false);

  // Persist WA settings
  useEffect(() => {
    localStorage.setItem("loyalty_wa_baseUrl", waBaseUrl);
    localStorage.setItem("loyalty_wa_apiKey", waApiKey);
    localStorage.setItem("loyalty_wa_authHeaderName", waAuthHeaderName);
    localStorage.setItem("loyalty_wa_authHeaderPrefix", waAuthHeaderPrefix);
    localStorage.setItem("loyalty_wa_fromNumber", waFromNumber);
    localStorage.setItem("loyalty_wa_campaignName", waCampaignName);
    localStorage.setItem("loyalty_wa_templateName", waTemplateName);
    localStorage.setItem("loyalty_wa_bodyMapping", waBodyMapping);
    localStorage.setItem("loyalty_wa_mediaHeader", String(waMediaHeader));
  }, [waBaseUrl, waApiKey, waAuthHeaderName, waAuthHeaderPrefix, waFromNumber, waCampaignName, waTemplateName, waBodyMapping, waMediaHeader]);

  const { data: templates = [] } = useQuery({
    queryKey: ["loyalty_card_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("loyalty_card_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await parseExcelFile(file);
      setExcelData(data);
      if (data.length > 0) {
        const cols = Object.keys(data[0]);
        const autoMap: Record<string, string> = {};
        const fields = ["Name", "Mobile", "UMR", "Discount %", "Expiry Date"];
        fields.forEach((f) => {
          const match = cols.find((c) => c.toLowerCase().includes(f.toLowerCase().replace(" %", "").replace("expiry ", "expir")));
          if (match) autoMap[f] = match;
        });
        setColumnMapping(autoMap);
      }
      toast({ title: `${data.length} rows loaded` });
    } catch {
      toast({ title: "Failed to parse Excel", variant: "destructive" });
    }
  };

  const excelColumns = excelData.length > 0 ? Object.keys(excelData[0]) : [];
  const FIELDS = ["Name", "Mobile", "UMR", "Discount %", "Expiry Date"];

  const formatExpiryDate = (value: unknown) => {
    if (value == null || value === "") return "";

    const formatParts = (day: number, month: number, year: number) => {
      const normalizedYear = year < 100 ? 2000 + year : year;
      return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${normalizedYear}`;
    };

    if (value instanceof Date && !isNaN(value.getTime())) {
      return formatParts(value.getDate(), value.getMonth() + 1, value.getFullYear());
    }

    const stringValue = String(value).trim();
    if (!stringValue) return "";

    const serialNumber = Number(stringValue);
    if (!isNaN(serialNumber) && serialNumber > 30000) {
      const d = new Date(Math.round((serialNumber - 25569) * 86400 * 1000));
      return formatParts(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
    }

    const slashMatch = stringValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return formatParts(Number(day), Number(month), Number(year));
    }

    const dashMatch = stringValue.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if (dashMatch) {
      const [, day, month, year] = dashMatch;
      return formatParts(Number(day), Number(month), Number(year));
    }

    const parsedDate = new Date(stringValue);
    if (!isNaN(parsedDate.getTime())) {
      return formatParts(parsedDate.getDate(), parsedDate.getMonth() + 1, parsedDate.getFullYear());
    }

    return stringValue;
  };

  const generateCards = async () => {
    if (!selectedTemplateId) return toast({ title: "Select a template", variant: "destructive" });
    if (excelData.length === 0) return toast({ title: "Upload an Excel file", variant: "destructive" });

    setGenerating(true);
    setProgress({ current: 0, total: excelData.length });

    try {
      // Create job
      const { data: job, error: jobError } = await supabase.from("loyalty_card_jobs").insert({
        template_id: selectedTemplateId,
        excel_data: excelData as any,
        status: "processing",
        total_cards: excelData.length,
        queue_enabled: queueEnabled,
        delay_ms: delayMs,
        whatsapp_template_name: waTemplateName || null,
        whatsapp_variables_mapping: waBodyMapping ? JSON.parse(waBodyMapping) : {},
      }).select().single();

      if (jobError) throw jobError;

      const template = templates.find((t: any) => t.id === selectedTemplateId);

      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];
        const patientData: Record<string, string> = {};
        FIELDS.forEach((f) => {
          const col = columnMapping[f];
          let val = col ? String(row[col] ?? "") : "";
          if (f === "Discount %" && val && !val.includes("%")) {
            val = val + "%";
          }
          if (f === "Expiry Date" && col) {
            val = formatExpiryDate(row[col]);
          }
          patientData[f] = val;
        });

        try {
          const res = await supabase.functions.invoke("generate-loyalty-card", {
            body: {
              backgroundUrl: template?.background_image_url,
              placeholders: template?.placeholders,
              patientData,
              jobId: job.id,
            },
          });

          if (res.error) throw res.error;

          const result = res.data;
          await supabase.from("loyalty_cards").insert({
            job_id: job.id,
            patient_name: patientData["Name"],
            mobile: patientData["Mobile"],
            umr: patientData["UMR"],
            discount: patientData["Discount %"],
            expiry_date: patientData["Expiry Date"],
            image_url: result?.imageUrl || null,
            whatsapp_status: "pending",
          });
        } catch (err) {
          console.error("Failed to generate card for row", i, err);
          await supabase.from("loyalty_cards").insert({
            job_id: job.id,
            patient_name: patientData["Name"],
            mobile: patientData["Mobile"],
            umr: patientData["UMR"],
            discount: patientData["Discount %"],
            expiry_date: patientData["Expiry Date"],
            whatsapp_status: "failed",
          });
        }

        setProgress({ current: i + 1, total: excelData.length });

        if (queueEnabled && i < excelData.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      await supabase.from("loyalty_card_jobs").update({ status: "completed", sent_count: excelData.length }).eq("id", job.id);
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      toast({ title: "All cards generated!" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };
  const sendViaWhatsApp = async (jobId: string) => {
    if (!waBaseUrl || !waApiKey || !waTemplateName) {
      return toast({ title: "Configure WhatsApp API settings first", variant: "destructive" });
    }

    setSending(true);
    try {
      const res = await supabase.functions.invoke("send-loyalty-whatsapp", {
        body: {
          jobId,
          apiBaseUrl: waBaseUrl,
          apiKey: waApiKey,
          authHeaderName: waAuthHeaderName,
          authHeaderPrefix: waAuthHeaderPrefix,
          fromNumber: waFromNumber,
          campaignName: waCampaignName,
          templateName: waTemplateName,
          variablesMapping: waBodyMapping ? JSON.parse(waBodyMapping) : {},
          includeMediaHeader: waMediaHeader,
          queueEnabled,
          delayMs,
        },
      });
      if (res.error) throw res.error;
      const result = res.data;
      toast({ title: `Sent ${result.sentCount}/${result.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
    } catch (err: any) {
      toast({ title: "WhatsApp send failed", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">1. Select Template & Upload Data</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Card Template</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Excel File</Label>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild><span><Upload className="h-4 w-4 mr-1" />Upload Excel</span></Button>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
              </label>
              {excelData.length > 0 && <p className="text-xs text-muted-foreground mt-1">{excelData.length} rows loaded</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">2. Column Mapping</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {FIELDS.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <Label className="text-xs w-24">{f}</Label>
                <Select value={columnMapping[f] || ""} onValueChange={(v) => setColumnMapping((prev) => ({ ...prev, [f]: v }))}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {excelColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">3. Queue Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={queueEnabled} onCheckedChange={setQueueEnabled} />
              <Label className="text-xs">Queue Mode</Label>
            </div>
            {queueEnabled && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">Delay (ms)</Label>
                <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} className="w-24 h-8" min={500} step={500} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Collapsible open={waSettingsOpen} onOpenChange={setWaSettingsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="py-3 cursor-pointer hover:bg-muted/50">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" />
                4. WhatsApp API Settings
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">API Base URL</Label>
                  <Input value={waBaseUrl} onChange={(e) => setWaBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">API Key</Label>
                  <div className="relative">
                    <Input type={showApiKey ? "text" : "password"} value={waApiKey} onChange={(e) => setWaApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Auth Header Name</Label>
                  <Input value={waAuthHeaderName} onChange={(e) => setWaAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">Auth Header Prefix (optional)</Label>
                  <Input value={waAuthHeaderPrefix} onChange={(e) => setWaAuthHeaderPrefix(e.target.value)} placeholder="Bearer / Basic / empty" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">From Number (with country code)</Label>
                  <Input value={waFromNumber} onChange={(e) => setWaFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">Campaign Name (optional)</Label>
                  <Input value={waCampaignName} onChange={(e) => setWaCampaignName(e.target.value)} placeholder="loyalty-cards" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">Template Name</Label>
                  <Input value={waTemplateName} onChange={(e) => setWaTemplateName(e.target.value)} placeholder="e.g. loyalty_card_v1" className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">Body Variables Mapping (JSON)</Label>
                  <Input value={waBodyMapping} onChange={(e) => setWaBodyMapping(e.target.value)} placeholder='{"1":"Name","2":"Discount %"}' className="h-8" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={waMediaHeader} onCheckedChange={setWaMediaHeader} />
                <Label className="text-xs">Include card image in media header</Label>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Preview Data */}
      {excelData.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Data Preview (first 5 rows)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-48">
              <Table>
                <TableHeader>
                  <TableRow>
                    {excelColumns.map((c) => <TableHead key={c} className="text-xs">{c}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {excelData.slice(0, 5).map((row, i) => (
                    <TableRow key={i}>
                      {excelColumns.map((c) => <TableCell key={c} className="text-xs">{String(row[c] ?? "")}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate Button */}
      <div className="flex items-center gap-4">
        <Button onClick={generateCards} disabled={generating || !selectedTemplateId || excelData.length === 0}>
          {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          {generating ? "Generating..." : "Generate Cards"}
        </Button>
        {generating && (
          <div className="flex-1 max-w-md space-y-1">
            <Progress value={(progress.current / progress.total) * 100} />
            <p className="text-xs text-muted-foreground">{progress.current} / {progress.total}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoyaltyCardSender;
