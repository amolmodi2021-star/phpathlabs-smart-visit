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
import { Upload, Play, Loader2 } from "lucide-react";
import { parseExcelFile } from "@/lib/excel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

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

  const normalizeIndianMobile = (value: string, withCountryCode = false) => {
    const digits = value.replace(/\D/g, "");
    const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
    if (!localNumber) return "";
    return withCountryCode ? `+91${localNumber}` : localNumber;
  };

  const encodeCode128C = (digits: string) => {
    if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) return null;

    const codes = [105];
    for (let i = 0; i < digits.length; i += 2) {
      codes.push(Number(digits.slice(i, i + 2)));
    }

    let checksum = 105;
    for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
    codes.push(checksum % 103);
    codes.push(106);
    return codes;
  };

  const drawBarcode = (
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    height: number,
    color: string,
  ) => {
    const digits = normalizeIndianMobile(value, false);
    if (!digits) return;

    const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`;
    const codes = encodeCode128C(evenDigits);
    if (!codes) return;

    const patterns = codes.map((code) => CODE128_PATTERNS[code]).filter(Boolean);
    const totalModules = patterns.reduce(
      (sum, pattern) => sum + pattern.split("").reduce((acc, width) => acc + Number(width), 0),
      0,
    );

    const targetWidth = Math.max(evenDigits.length * height * 0.38, height * 2.8);
    const moduleWidth = targetWidth / totalModules;

    ctx.save();
    ctx.fillStyle = color;

    let cursorX = x;
    for (const pattern of patterns) {
      pattern.split("").forEach((segment, index) => {
        const width = Number(segment) * moduleWidth;
        if (index % 2 === 0) {
          ctx.fillRect(cursorX, y, width, height);
        }
        cursorX += width;
      });
    }

    ctx.restore();
  };

  // Load background image as data URL to avoid CORS/tainted canvas issues
  const loadImage = async (url: string): Promise<HTMLImageElement> => {
    // Fetch the image as a blob first to avoid tainted canvas
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch background image");
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load background image"));
      img.src = dataUrl;
    });
  };

  // Render a single card on an existing canvas (no image reload)
  const renderCard = async (
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    bgImg: HTMLImageElement,
    placeholders: any[],
    patientData: Record<string, string>,
  ): Promise<Blob> => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgImg, 0, 0);

    for (const p of placeholders) {
      const isBarcode = p.field === "Barcode";
      const text = isBarcode ? (patientData["Mobile"] || "") : (patientData[p.field] || "");
      if (!text) continue;
      const x = (p.x / 100) * canvas.width;
      const y = (p.y / 100) * canvas.height;
      const fontSize = p.fontSize || 32;
      const fontColor = p.fontColor || "#000000";

      if (isBarcode) {
        drawBarcode(ctx, text, x, y, fontSize, fontColor);
        continue;
      }

      const bold = p.bold ? "bold" : "normal";
      ctx.font = `${bold} ${fontSize}px Arial, Helvetica, sans-serif`;

      ctx.fillStyle = fontColor;
      ctx.textBaseline = "top";
      ctx.fillText(text, x, y);
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to render card image"));
      }, "image/png");
    });
  };

  const generateCards = async () => {
    if (!selectedTemplateId) return toast({ title: "Select a template", variant: "destructive" });
    if (excelData.length === 0) return toast({ title: "Upload an Excel file", variant: "destructive" });

    setGenerating(true);
    setProgress({ current: 0, total: excelData.length });

    try {
      const template = templates.find((t: any) => t.id === selectedTemplateId);
      if (!template?.background_image_url) throw new Error("Template has no background image");

      const bgImg = await loadImage(template.background_image_url);
      const canvas = document.createElement("canvas");
      canvas.width = bgImg.naturalWidth;
      canvas.height = bgImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");

      // Create job
      const { data: job, error: jobError } = await supabase.from("loyalty_card_jobs").insert({
        template_id: selectedTemplateId,
        excel_data: excelData as any,
        status: "processing",
        total_cards: excelData.length,
        queue_enabled: queueEnabled,
        delay_ms: delayMs,
        whatsapp_template_name: null,
        whatsapp_variables_mapping: {},
      }).select().single();

      if (jobError) throw jobError;

      const placeholders = (template.placeholders as any[]) || [];
      const BATCH_SIZE = 5; // Upload 5 in parallel

      for (let i = 0; i < excelData.length; i += BATCH_SIZE) {
        const batch = excelData.slice(i, i + BATCH_SIZE);

        // Canvas can't be shared in parallel, so render sequentially then upload in parallel
         const renderResults: { patientData: Record<string, string>; blob: Blob }[] = [];
        for (let b = 0; b < batch.length; b++) {
          const row = batch[b];
          const patientData: Record<string, string> = {};
          FIELDS.forEach((f) => {
            const col = columnMapping[f];
            let val = col ? String(row[col] ?? "") : "";
             if (f === "Mobile" && val) val = normalizeIndianMobile(val, false);
            if (f === "Discount %" && val && !val.includes("%")) val = val + "%";
            if (f === "Expiry Date" && col) val = formatExpiryDate(row[col]);
            patientData[f] = val;
          });
           const blob = await renderCard(canvas, ctx, bgImg, placeholders, patientData);
          renderResults.push({ patientData, blob });
        }

        // Upload all blobs in parallel
        await Promise.all(renderResults.map(async ({ patientData, blob }, batchIdx) => {
          const idx = i + batchIdx;
          try {
            const fileName = `generated/${job.id}/${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}.png`;
            const { error: uploadError } = await supabase.storage
              .from("loyalty-cards")
              .upload(fileName, blob, { contentType: "image/png" });
            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);
            await supabase.from("loyalty_cards").insert({
              job_id: job.id,
              patient_name: patientData["Name"],
              mobile: patientData["Mobile"],
              umr: patientData["UMR"],
              discount: patientData["Discount %"],
              expiry_date: patientData["Expiry Date"],
              image_url: urlData.publicUrl,
              whatsapp_status: "pending",
            });
          } catch (err) {
            console.error("Failed card for row", idx, err);
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
        }));

        setProgress({ current: Math.min(i + BATCH_SIZE, excelData.length), total: excelData.length });
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
      const payload = {
        jobId,
        apiBaseUrl: waBaseUrl,
        apiKey: "***hidden***",
        authHeaderName: waAuthHeaderName,
        authHeaderPrefix: waAuthHeaderPrefix,
        fromNumber: waFromNumber,
        campaignName: waCampaignName,
        templateName: waTemplateName,
        variablesMapping: waBodyMapping ? JSON.parse(waBodyMapping) : {},
        includeMediaHeader: waMediaHeader,
        queueEnabled,
        delayMs,
      };
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "REQUEST → Edge Function", data: payload }]);

      const res = await supabase.functions.invoke("send-loyalty-whatsapp", {
        body: {
          ...payload,
          apiKey: waApiKey,
        },
      });
      if (res.error) throw res.error;
      const result = res.data;
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "RESPONSE ← Edge Function", data: result }]);
      toast({ title: `Sent ${result.sentCount}/${result.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
    } catch (err: any) {
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "ERROR", data: err.message }]);
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

      {/* API Payload Logs */}
      {apiLogs.length > 0 && (
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> WhatsApp API Payload Logs</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setApiLogs([])}>Clear Logs</Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
            {apiLogs.map((log, idx) => (
              <div key={idx} className="border rounded p-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-bold ${log.direction.includes("ERROR") ? "text-red-600" : log.direction.includes("RESPONSE") ? "text-green-600" : "text-blue-600"}`}>
                    {log.direction}
                  </span>
                  <span className="text-muted-foreground">{log.timestamp}</span>
                </div>
                <pre className="whitespace-pre-wrap bg-muted rounded p-2 font-mono text-xs overflow-x-auto">
                  {typeof log.data === "string" ? log.data : JSON.stringify(log.data, null, 2)}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default LoyaltyCardSender;
