import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, Play, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { parseExcelFile } from "@/lib/excel";
import { exportCanvasAsCompressedJpeg } from "@/lib/cardRenderer";
import { uploadJpegToCloudinaryWithRetry } from "@/lib/cardStorageCloudinary";
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
  const [useStaticExpiry, setUseStaticExpiry] = useState(true);
  const [staticExpiryDate, setStaticExpiryDate] = useState("");

  // Load saved static expiry settings + global WhatsApp delay from app_settings
  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "loyalty_static_expiry_enabled",
          "loyalty_static_expiry_date",
          "wa_global_delayMs",
          "wa_global_queueEnabled",
        ]);
      if (data) {
        for (const row of data) {
          if (row.setting_key === "loyalty_static_expiry_enabled") setUseStaticExpiry(row.setting_value === "true");
          if (row.setting_key === "loyalty_static_expiry_date") setStaticExpiryDate(row.setting_value);
          // Mirror the WhatsApp Settings delay so the job row records the same
          // pacing the sender will actually use. Avoids a stale "3s" default
          // when the user has configured 1s in WhatsApp Settings.
          if (row.setting_key === "wa_global_delayMs") {
            const n = Number(row.setting_value);
            if (!Number.isNaN(n) && n >= 0) setDelayMs(n);
          }
          if (row.setting_key === "wa_global_queueEnabled") setQueueEnabled(row.setting_value !== "false");
        }
      }
    };
    loadSettings();
  }, []);

  // Save static expiry settings whenever they change
  const saveExpirySetting = useCallback(async (key: string, value: string) => {
    await supabase.from("app_settings").upsert(
      { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
      { onConflict: "setting_key" }
    );
  }, []);

  const handleStaticExpiryToggle = (checked: boolean) => {
    setUseStaticExpiry(checked);
    saveExpirySetting("loyalty_static_expiry_enabled", String(checked));
  };

  const handleStaticExpiryDateChange = (val: string) => {
    setStaticExpiryDate(val);
    saveExpirySetting("loyalty_static_expiry_date", val);
  };

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

    // Downscaled JPEG (max 800px width, q=0.72) — ~55% smaller than full PNG, slashes WhatsApp egress.
    return await exportCanvasAsCompressedJpeg(canvas);
  };

  const generateCards = async () => {
    if (!selectedTemplateId) return toast({ title: "Select a template", variant: "destructive" });
    if (excelData.length === 0) return toast({ title: "Upload an Excel file", variant: "destructive" });

    setGenerating(true);
    setProgress({ current: 0, total: excelData.length });

    try {
      const template = templates.find((t: any) => t.id === selectedTemplateId);
      if (!template?.background_image_url) throw new Error("Template has no background image");

      // Load WhatsApp config + ABC Card marketing template (mirrors AbnormalBulkSender)
      const { data: settings } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .like("setting_key", "wa_global_%");
      const cfg: Record<string, string> = {};
      (settings || []).forEach((s: any) => { cfg[s.setting_key] = s.setting_value; });

      const { data: tmpl } = await supabase
        .from("marketing_templates")
        .select("whatsapp_template_name, body_mapping, api_base_url, from_number")
        .eq("template_name", "ABC Card")
        .maybeSingle();

      const apiBaseUrl = cfg["wa_global_baseUrl"];
      const apiKey = cfg["wa_global_apiKey"];
      const templateName = (tmpl as any)?.whatsapp_template_name || "";
      const authHeaderName = cfg["wa_global_authHeaderName"] || "apikey";
      const authHeaderPrefix = cfg["wa_global_authHeaderPrefix"] || "";
      const fromNumber = cfg["wa_global_fromNumber"] || "";
      const campaignName = (tmpl as any)?.api_base_url || "";
      const includeMediaHeader = (tmpl as any)?.from_number === "media_header_enabled";
      const sendQueueEnabled = cfg["wa_global_queueEnabled"] !== "false";
      const sendDelayRaw = Number(cfg["wa_global_delayMs"]);
      const sendDelayMs = Number.isFinite(sendDelayRaw) && sendDelayRaw >= 0 ? sendDelayRaw : 1000;

      if (!apiBaseUrl || !apiKey || !templateName) {
        throw new Error("WhatsApp not configured. Set up 'ABC Card' marketing template and WhatsApp Settings.");
      }

      const bgImg = await loadImage(template.background_image_url);
      const canvas = document.createElement("canvas");
      canvas.width = bgImg.naturalWidth;
      canvas.height = bgImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");

      const placeholders = (template.placeholders as any[]) || [];
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < excelData.length; i++) {
        const row = excelData[i];
        const patientData: Record<string, string> = {};
        FIELDS.forEach((f) => {
          const col = columnMapping[f];
          let val = col ? String(row[col] ?? "") : "";
          if (f === "Mobile" && val) val = normalizeIndianMobile(val, false);
          if (f === "Discount %" && val && !val.includes("%")) val = val + "%";
          if (f === "Expiry Date") {
            if (useStaticExpiry && staticExpiryDate) {
              val = staticExpiryDate;
            } else if (col) {
              val = formatExpiryDate(row[col]);
            }
          }
          patientData[f] = val;
        });

        try {
          const blob = await renderCard(canvas, ctx, bgImg, placeholders, patientData);
          const imageUrl = await uploadJpegToCloudinaryWithRetry(async () => blob);

          const mobile = patientData["Mobile"];
          if (!mobile) throw new Error("Missing mobile");
          const toNumber = `+91${mobile}`;
          const components: Record<string, unknown> = {};
          if (includeMediaHeader) {
            components.header = { type: "image", image: { link: imageUrl } };
          }
          components.body = { params: [(patientData["Name"] || patientData["UMR"] || "").toUpperCase()] };

          const payload = {
            from: fromNumber,
            to: toNumber,
            templateName,
            campaignName,
            type: "template",
            components,
          };

          const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
            body: { apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
          });

          const resStatus = (proxyRes.data as any)?.status ?? 0;
          if (proxyRes.error || resStatus >= 400) {
            throw new Error(
              (proxyRes.data as any)?.body?.slice?.(0, 200) ||
                proxyRes.error?.message ||
                `HTTP ${resStatus}`,
            );
          }
          sentCount++;
        } catch (err: any) {
          failedCount++;
          console.error("Failed card for row", i, err);
        }

        setProgress({ current: i + 1, total: excelData.length });

        if (sendQueueEnabled && sendDelayMs > 0 && i < excelData.length - 1) {
          await new Promise((r) => setTimeout(r, sendDelayMs));
        }
      }

      toast({
        title: "Generate & Send complete",
        description: `Sent: ${sentCount} · Failed: ${failedCount}`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
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

      {/* Expiry Date Option */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">3. Expiry Date</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={useStaticExpiry} onCheckedChange={handleStaticExpiryToggle} />
            <Label className="text-xs">{useStaticExpiry ? "Use static expiry date for all cards" : "Use expiry date from Excel data"}</Label>
          </div>
          {useStaticExpiry && (
            <div>
              <Label className="text-xs">Expiry Date (dd-mm-yyyy)</Label>
              <Input
                placeholder="e.g. 31-12-2026"
                value={staticExpiryDate}
                onChange={(e) => handleStaticExpiryDateChange(e.target.value)}
                className="h-8 max-w-xs"
              />
            </div>
          )}
        </CardContent>
      </Card>

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
          {generating ? "Generating & Sending..." : "Generate & Send Cards"}
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
