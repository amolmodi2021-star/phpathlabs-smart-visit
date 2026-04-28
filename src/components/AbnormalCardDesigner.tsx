/**
 * Abnormal Card Designer — edits rows in `abnormal_card_templates`.
 *
 * Was previously housed under the (now removed) CRM section. Lives in the
 * Loyalty Cards page next to the Loyalty Card Designer. Renders a live
 * preview using the same canvas math as `generateAbnormalCardForDrip`.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Upload } from "lucide-react";

type Align = "left" | "center" | "right";

interface Placeholder {
  field: string; // Name | Mobile | UMR | Barcode
  x: number; // % of canvas width
  y: number; // px within details band
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
}

interface Band {
  text?: string;
  height?: number;
  color?: string;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  align?: Align;
  position?: "above-table" | "below-table";
}

interface FooterLine {
  text: string;
  align?: Align;
  bold?: boolean;
  fontSize?: number;
  fontColor?: string;
}

interface TableConfig {
  headerBg?: string;
  headerFontColor?: string;
  headerFontSize?: number;
  headerFont?: string;
  rowFontSize?: number;
  rowFontColor?: string;
  rowHeight?: number;
  altRowColor?: string;
  borderColor?: string;
  resultColor?: string;
  colWidths?: number[];
  colAligns?: Align[];
}

interface Template {
  name: string;
  canvas_width: number;
  background_color: string;
  show_header_band: boolean;
  header_band_height: number;
  header_bg_color: string;
  header_font_color: string;
  logo_url: string | null;
  logo_x: number;
  logo_y: number;
  logo_width: number;
  logo_height: number;
  placeholders: Placeholder[];
  details_band_height?: number | null;
  bands: Band[];
  table_config: TableConfig;
  footer_lines: FooterLine[];
}

const FIELD_OPTIONS = ["Name", "Mobile", "UMR", "Barcode"];

const SAMPLE_TESTS = [
  { test_name: "Hemoglobin", test_date: "15-04-2026", result_value: "9.2", normal_range: "13.0 - 17.0" },
  { test_name: "Glucose Fasting", test_date: "15-04-2026", result_value: "165", normal_range: "70 - 110" },
  { test_name: "TSH", test_date: "12-04-2026", result_value: "8.5", normal_range: "0.4 - 4.0" },
];
const SAMPLE_PATIENT = { patient_name: "JOHN DOE", mobile_number: "9876543210", umr_number: "UMR001234" };

const DEFAULT_TPL: Template = {
  name: "",
  canvas_width: 900,
  background_color: "#FFFFFF",
  show_header_band: true,
  header_band_height: 130,
  header_bg_color: "#FFFFFF",
  header_font_color: "#000000",
  logo_url: null,
  logo_x: 20,
  logo_y: 20,
  logo_width: 200,
  logo_height: 80,
  placeholders: [
    { field: "Name", x: 5, y: 10, fontSize: 28, fontColor: "#000000", bold: true },
    { field: "Mobile", x: 5, y: 50, fontSize: 22, fontColor: "#333333" },
    { field: "UMR", x: 5, y: 85, fontSize: 22, fontColor: "#333333" },
    { field: "Barcode", x: 60, y: 30, fontSize: 50, fontColor: "#000000" },
  ],
  details_band_height: null,
  bands: [
    { text: "HEALTH HISTORY FOR", height: 50, color: "#2E3192", textColor: "#FFFFFF", fontSize: 22, bold: true, align: "center", position: "above-table" },
  ],
  table_config: {
    headerBg: "#2E3192",
    headerFontColor: "#FFFFFF",
    headerFontSize: 16,
    headerFont: "Arial",
    rowFontSize: 22,
    rowFontColor: "#333333",
    rowHeight: 50,
    altRowColor: "#F9F9FC",
    borderColor: "#E0E0E8",
    resultColor: "#ed1c23",
    colWidths: [0.38, 0.18, 0.18, 0.26],
    colAligns: ["left", "center", "center", "center"],
  },
  footer_lines: [
    { text: "Powered by PH PathLabs · LabLine 6356 55 66 99", align: "center", fontSize: 16, fontColor: "#666666" },
  ],
};

// === Renderer (mirrors generateAbnormalCardForDrip) ===
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

function normalizeMobile(v: string) { const d = (v || "").replace(/\D/g, ""); return d.length > 10 ? d.slice(-10) : d; }
function encodeCode128C(digits: string) {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) return null;
  const codes = [105];
  for (let i = 0; i < digits.length; i += 2) codes.push(Number(digits.slice(i, i + 2)));
  let cs = 105; for (let i = 1; i < codes.length; i++) cs += codes[i] * i;
  codes.push(cs % 103); codes.push(106); return codes;
}
function drawBarcode(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, height: number, color: string) {
  const digits = normalizeMobile(value); if (!digits) return;
  const even = digits.length % 2 === 0 ? digits : `0${digits}`;
  const codes = encodeCode128C(even); if (!codes) return;
  const patterns = codes.map((c) => CODE128_PATTERNS[c]).filter(Boolean);
  const total = patterns.reduce((s, p) => s + p.split("").reduce((a, w) => a + Number(w), 0), 0);
  const target = Math.max(even.length * height * 0.38, height * 2.8);
  const mw = target / total;
  ctx.save(); ctx.fillStyle = color;
  let cx = x;
  for (const pat of patterns) {
    pat.split("").forEach((seg, idx) => {
      const w = Number(seg) * mw;
      if (idx % 2 === 0) ctx.fillRect(cx, y, w, height);
      cx += w;
    });
  }
  ctx.restore();
}

async function renderAbnormalPreview(canvas: HTMLCanvasElement, tpl: Template, logoImg: HTMLImageElement | null) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const canvasWidth = tpl.canvas_width || 900;
  const headerBandHeight = tpl.show_header_band ? (tpl.header_band_height || 130) : 0;
  const autoDetails = (tpl.placeholders || []).reduce((m, p) => Math.max(m, (p.y || 0) + (p.fontSize || 25) + 10), 60);
  const detailsBandHeight = tpl.details_band_height && tpl.details_band_height > 0 ? tpl.details_band_height : autoDetails;
  const bandsAbove = (tpl.bands || []).filter((b) => b.position === "above-table");
  const bandsBelow = (tpl.bands || []).filter((b) => b.position === "below-table");
  const aboveT = bandsAbove.reduce((s, b) => s + (b.height || 60), 0);
  const belowT = bandsBelow.reduce((s, b) => s + (b.height || 30), 0);
  const tc = tpl.table_config || {};
  const rowH = tc.rowHeight || 60;
  const headerFs = tc.headerFontSize || 16;
  const tHeaderH = headerFs + 24;
  const tableH = tHeaderH + SAMPLE_TESTS.length * rowH;
  const footerH = (tpl.footer_lines || []).reduce((s, fl) => s + (fl.fontSize || 20) + 14, 30);
  const padding = 30;
  const canvasHeight = headerBandHeight + detailsBandHeight + aboveT + tableH + belowT + footerH + padding;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  ctx.fillStyle = tpl.background_color || "#FFFFFF";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let cy = 0;
  if (tpl.show_header_band && headerBandHeight > 0) {
    ctx.fillStyle = tpl.header_bg_color || "#FFFFFF";
    ctx.fillRect(0, cy, canvasWidth, headerBandHeight);
    if (logoImg) {
      try { ctx.drawImage(logoImg, tpl.logo_x ?? 20, (tpl.logo_y ?? 20) + cy, tpl.logo_width || 200, tpl.logo_height || 80); } catch {}
    }
    cy += headerBandHeight;
  }

  const detailsTop = cy;
  for (const p of tpl.placeholders || []) {
    const fs = p.fontSize || 25;
    const fc = p.fontColor || "#000000";
    const xPx = ((p.x || 0) / 100) * canvasWidth;
    const yPx = detailsTop + (p.y || 0);
    if (p.field === "Barcode") { drawBarcode(ctx, SAMPLE_PATIENT.mobile_number, xPx, yPx, fs, fc); continue; }
    let text = "";
    if (p.field === "Name") text = SAMPLE_PATIENT.patient_name;
    else if (p.field === "Mobile") text = SAMPLE_PATIENT.mobile_number;
    else if (p.field === "UMR") text = SAMPLE_PATIENT.umr_number;
    if (!text) continue;
    ctx.font = `${p.bold ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = fc; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillText(text, xPx, yPx);
  }
  cy += detailsBandHeight;

  const drawBand = (b: Band) => {
    const h = b.height || 60;
    ctx.fillStyle = b.color || "#2E3192";
    ctx.fillRect(0, cy, canvasWidth, h);
    if (b.text) {
      const fs = b.fontSize || 24;
      ctx.font = `${b.bold ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = b.textColor || "#FFFFFF"; ctx.textBaseline = "middle";
      const al = b.align || "left"; ctx.textAlign = al;
      const tx = al === "center" ? canvasWidth / 2 : al === "right" ? canvasWidth - 20 : 20;
      const fullText = /history for/i.test(b.text) ? `${b.text} ${SAMPLE_PATIENT.patient_name}`.trim() : b.text;
      ctx.fillText(fullText, tx, cy + h / 2);
      ctx.textAlign = "left";
    }
    cy += h;
  };
  bandsAbove.forEach(drawBand);

  const colWeights = tc.colWidths && tc.colWidths.length === 4 ? tc.colWidths : [0.38, 0.18, 0.18, 0.26];
  const colWidths = colWeights.map((w) => Math.floor(w * canvasWidth));
  const colAligns: Align[] = (tc.colAligns && tc.colAligns.length === 4 ? tc.colAligns : ["left","center","center","center"]) as Align[];

  // Helper: shrink font size until text fits within maxWidth
  const fitFontSize = (text: string, baseSize: number, maxWidth: number, bold: boolean, family: string) => {
    let size = baseSize;
    while (size > 8) {
      ctx.font = `${bold ? "bold " : ""}${size}px ${family}, Helvetica, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 1;
    }
    return size;
  };

  ctx.fillStyle = tc.headerBg || "#2E3192";
  ctx.fillRect(0, cy, canvasWidth, tHeaderH);
  ctx.fillStyle = tc.headerFontColor || "#FFFFFF"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const headers = ["Test Name", "Date", "Result", "Normal Range"];
  let xc = 0;
  headers.forEach((h, i) => {
    const fs = fitFontSize(h, headerFs, colWidths[i] - 12, true, tc.headerFont || "Arial");
    ctx.font = `bold ${fs}px ${tc.headerFont || "Arial"}, Helvetica, sans-serif`;
    ctx.fillText(h, xc + colWidths[i] / 2, cy + tHeaderH / 2);
    xc += colWidths[i];
  });
  cy += tHeaderH;

  const rfs = tc.rowFontSize || 24;
  const rfc = tc.rowFontColor || "#333333";
  const alt = tc.altRowColor || "#F9F9FC";
  const bc = tc.borderColor || "#E0E0E8";
  const rc = tc.resultColor || "#ed1c23";
  SAMPLE_TESTS.forEach((t, i) => {
    if (i % 2 === 1) { ctx.fillStyle = alt; ctx.fillRect(0, cy, canvasWidth, rowH); }
    const cells = [t.test_name, t.test_date, t.result_value, t.normal_range];
    let cx = 0;
    cells.forEach((cell, ci) => {
      const al = colAligns[ci] || "center";
      const isResult = ci === 2;
      const maxW = colWidths[ci] - 12;
      const fs = fitFontSize(cell, rfs, maxW, isResult, "Arial");
      ctx.fillStyle = isResult ? rc : rfc;
      ctx.font = `${isResult ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
      ctx.textBaseline = "middle"; ctx.textAlign = al;
      const tx = al === "left" ? cx + 18 : al === "right" ? cx + colWidths[ci] - 18 : cx + colWidths[ci] / 2;
      ctx.fillText(cell, tx, cy + rowH / 2);
      cx += colWidths[ci];
    });
    ctx.strokeStyle = bc; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy + rowH); ctx.lineTo(canvasWidth, cy + rowH); ctx.stroke();
    cy += rowH;
  });
  bandsBelow.forEach(drawBand);

  cy += 10; ctx.textBaseline = "top";
  (tpl.footer_lines || []).forEach((fl) => {
    const fs = fl.fontSize || 20;
    ctx.font = `${fl.bold ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = fl.fontColor || "#666666";
    const al = fl.align || "left"; ctx.textAlign = al;
    const tx = al === "center" ? canvasWidth / 2 : al === "right" ? canvasWidth - 20 : 20;
    ctx.fillText(fl.text || "", tx, cy);
    cy += fs + 8;
  });
}

const AbnormalCardDesigner = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tpl, setTpl] = useState<Template>(DEFAULT_TPL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["abnormal_card_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("abnormal_card_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Load logo image when url changes
  useEffect(() => {
    if (!tpl.logo_url) { setLogoImg(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setLogoImg(img);
    img.onerror = () => setLogoImg(null);
    img.src = tpl.logo_url;
  }, [tpl.logo_url]);

  const drawPreview = useCallback(() => {
    if (canvasRef.current) renderAbnormalPreview(canvasRef.current, tpl, logoImg);
  }, [tpl, logoImg]);

  useEffect(() => { drawPreview(); }, [drawPreview]);

  const update = (patch: Partial<Template>) => setTpl((prev) => ({ ...prev, ...patch }));
  const updateTC = (patch: Partial<TableConfig>) => setTpl((prev) => ({ ...prev, table_config: { ...prev.table_config, ...patch } }));

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ext = file.name.split(".").pop();
    const path = `abnormal-logos/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("loyalty-cards").upload(path, file);
    if (error) { toast({ title: "Logo upload failed", description: error.message, variant: "destructive" }); return; }
    const { data } = supabase.storage.from("loyalty-cards").getPublicUrl(path);
    update({ logo_url: data.publicUrl });
    toast({ title: "Logo uploaded" });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tpl.name.trim()) throw new Error("Template name is required");
      const payload = {
        name: tpl.name,
        canvas_width: tpl.canvas_width,
        background_color: tpl.background_color,
        show_header_band: tpl.show_header_band,
        header_band_height: tpl.header_band_height,
        details_band_height: tpl.details_band_height ?? null,
        header_bg_color: tpl.header_bg_color,
        header_font_color: tpl.header_font_color,
        logo_url: tpl.logo_url,
        logo_x: tpl.logo_x, logo_y: tpl.logo_y, logo_width: tpl.logo_width, logo_height: tpl.logo_height,
        placeholders: tpl.placeholders as any,
        bands: tpl.bands as any,
        table_config: tpl.table_config as any,
        footer_lines: tpl.footer_lines as any,
      };
      if (editingId) {
        const { error } = await supabase.from("abnormal_card_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("abnormal_card_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abnormal_card_templates"] });
      toast({ title: editingId ? "Template updated" : "Template saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const loadTemplate = (t: any) => {
    setEditingId(t.id);
    setTpl({
      name: t.name || "",
      canvas_width: t.canvas_width || 900,
      background_color: t.background_color || "#FFFFFF",
      show_header_band: t.show_header_band !== false,
      header_band_height: t.header_band_height || 130,
      details_band_height: t.details_band_height ?? null,
      header_bg_color: t.header_bg_color || "#FFFFFF",
      header_font_color: t.header_font_color || "#000000",
      logo_url: t.logo_url || null,
      logo_x: t.logo_x ?? 20, logo_y: t.logo_y ?? 20,
      logo_width: t.logo_width || 200, logo_height: t.logo_height || 80,
      placeholders: (t.placeholders as Placeholder[]) || [],
      bands: (t.bands as Band[]) || [],
      table_config: (t.table_config as TableConfig) || {},
      footer_lines: (t.footer_lines as FooterLine[]) || [],
    });
  };

  const newTemplate = () => { setEditingId(null); setTpl(DEFAULT_TPL); };

  const deleteTemplate = async (id: string) => {
    await supabase.from("abnormal_card_templates").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["abnormal_card_templates"] });
    if (editingId === id) newTemplate();
    toast({ title: "Template deleted" });
  };

  // === Placeholders editing ===
  const addPlaceholder = () => {
    const used = tpl.placeholders.map((p) => p.field);
    const next = FIELD_OPTIONS.find((f) => !used.includes(f)) || "Name";
    update({ placeholders: [...tpl.placeholders, { field: next, x: 5, y: 10, fontSize: 22, fontColor: "#000000", bold: false }] });
  };
  const updatePh = (i: number, patch: Partial<Placeholder>) => {
    update({ placeholders: tpl.placeholders.map((p, idx) => idx === i ? { ...p, ...patch } : p) });
  };
  const removePh = (i: number) => update({ placeholders: tpl.placeholders.filter((_, idx) => idx !== i) });

  // === Bands ===
  const addBand = (position: "above-table" | "below-table") => {
    update({ bands: [...tpl.bands, { text: "BAND TEXT", height: 50, color: "#2E3192", textColor: "#FFFFFF", fontSize: 22, bold: true, align: "center", position }] });
  };
  const updateBand = (i: number, patch: Partial<Band>) => update({ bands: tpl.bands.map((b, idx) => idx === i ? { ...b, ...patch } : b) });
  const removeBand = (i: number) => update({ bands: tpl.bands.filter((_, idx) => idx !== i) });

  // === Footer lines ===
  const addFooter = () => update({ footer_lines: [...tpl.footer_lines, { text: "Footer text", align: "center", fontSize: 16, fontColor: "#666666" }] });
  const updateFooter = (i: number, patch: Partial<FooterLine>) => update({ footer_lines: tpl.footer_lines.map((f, idx) => idx === i ? { ...f, ...patch } : f) });
  const removeFooter = (i: number) => update({ footer_lines: tpl.footer_lines.filter((_, idx) => idx !== i) });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Preview */}
      <div className="lg:col-span-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Template Name" value={tpl.name} onChange={(e) => update({ name: e.target.value })} className="max-w-xs" />
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />{editingId ? "Update" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={newTemplate}>New</Button>
        </div>
        <div className="border rounded-lg overflow-auto bg-muted p-2 max-h-[80vh]">
          <canvas ref={canvasRef} style={{ width: "100%", height: "auto", background: "#fff" }} />
        </div>
        <p className="text-xs text-muted-foreground">Preview uses sample patient & 3 sample tests.</p>
      </div>

      {/* Editor */}
      <div className="lg:col-span-2 space-y-3 max-h-[85vh] overflow-y-auto pr-1">
        {/* Canvas / Background */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Canvas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Width (px)</Label><Input type="number" value={tpl.canvas_width} onChange={(e) => update({ canvas_width: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Background</Label><input type="color" value={tpl.background_color} onChange={(e) => update({ background_color: e.target.value })} className="h-9 w-full rounded border" /></div>
            </div>
          </CardContent>
        </Card>

        {/* Header Band + Logo */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between">Header Band
            <Switch checked={tpl.show_header_band} onCheckedChange={(v) => update({ show_header_band: v })} />
          </CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Height</Label><Input type="number" value={tpl.header_band_height} onChange={(e) => update({ header_band_height: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Bg Color</Label><input type="color" value={tpl.header_bg_color} onChange={(e) => update({ header_bg_color: e.target.value })} className="h-9 w-full rounded border" /></div>
            </div>
            <div>
              <Label className="text-xs">Logo</Label>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild><span><Upload className="h-3 w-3 mr-1" />Upload</span></Button>
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
                {tpl.logo_url && <img src={tpl.logo_url} alt="logo" className="h-8" />}
                {tpl.logo_url && <Button size="sm" variant="ghost" onClick={() => update({ logo_url: null })}><Trash2 className="h-3 w-3" /></Button>}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div><Label className="text-xs">X</Label><Input type="number" value={tpl.logo_x} onChange={(e) => update({ logo_x: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Y</Label><Input type="number" value={tpl.logo_y} onChange={(e) => update({ logo_y: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">W</Label><Input type="number" value={tpl.logo_width} onChange={(e) => update({ logo_width: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">H</Label><Input type="number" value={tpl.logo_height} onChange={(e) => update({ logo_height: Number(e.target.value) })} /></div>
            </div>
          </CardContent>
        </Card>

        {/* Patient Placeholders */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between">Patient Details
            <Button size="sm" variant="outline" onClick={addPlaceholder}><Plus className="h-3 w-3 mr-1" />Add</Button>
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {tpl.placeholders.map((p, i) => (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={p.field} onValueChange={(v) => updatePh(i, { field: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removePh(i)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">X (%)</Label><Input type="number" value={p.x} onChange={(e) => updatePh(i, { x: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">Y (px)</Label><Input type="number" value={p.y} onChange={(e) => updatePh(i, { y: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">Size</Label><Input type="number" value={p.fontSize || 22} onChange={(e) => updatePh(i, { fontSize: Number(e.target.value) })} /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={p.fontColor || "#000000"} onChange={(e) => updatePh(i, { fontColor: e.target.value })} className="h-8 w-12 rounded border" />
                  <Switch checked={!!p.bold} onCheckedChange={(v) => updatePh(i, { bold: v })} />
                  <Label className="text-xs">Bold</Label>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Bands */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between">Bands
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => addBand("above-table")}><Plus className="h-3 w-3 mr-1" />Above</Button>
              <Button size="sm" variant="outline" onClick={() => addBand("below-table")}><Plus className="h-3 w-3 mr-1" />Below</Button>
            </div>
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {tpl.bands.map((b, i) => (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{b.position}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" onClick={() => removeBand(i)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <Input value={b.text || ""} onChange={(e) => updateBand(i, { text: e.target.value })} placeholder="Band text" />
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">Height</Label><Input type="number" value={b.height || 50} onChange={(e) => updateBand(i, { height: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">Size</Label><Input type="number" value={b.fontSize || 22} onChange={(e) => updateBand(i, { fontSize: Number(e.target.value) })} /></div>
                  <div><Label className="text-xs">Align</Label>
                    <Select value={b.align || "center"} onValueChange={(v) => updateBand(i, { align: v as Align })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="center">Center</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Bg</Label>
                  <input type="color" value={b.color || "#2E3192"} onChange={(e) => updateBand(i, { color: e.target.value })} className="h-8 w-12 rounded border" />
                  <Label className="text-xs">Text</Label>
                  <input type="color" value={b.textColor || "#FFFFFF"} onChange={(e) => updateBand(i, { textColor: e.target.value })} className="h-8 w-12 rounded border" />
                  <Switch checked={!!b.bold} onCheckedChange={(v) => updateBand(i, { bold: v })} />
                  <Label className="text-xs">Bold</Label>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Tests Table</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Header Bg</Label><input type="color" value={tpl.table_config.headerBg || "#2E3192"} onChange={(e) => updateTC({ headerBg: e.target.value })} className="h-9 w-full rounded border" /></div>
              <div><Label className="text-xs">Header Text</Label><input type="color" value={tpl.table_config.headerFontColor || "#FFFFFF"} onChange={(e) => updateTC({ headerFontColor: e.target.value })} className="h-9 w-full rounded border" /></div>
              <div><Label className="text-xs">Header Size</Label><Input type="number" value={tpl.table_config.headerFontSize || 16} onChange={(e) => updateTC({ headerFontSize: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Row Height</Label><Input type="number" value={tpl.table_config.rowHeight || 50} onChange={(e) => updateTC({ rowHeight: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Row Size</Label><Input type="number" value={tpl.table_config.rowFontSize || 22} onChange={(e) => updateTC({ rowFontSize: Number(e.target.value) })} /></div>
              <div><Label className="text-xs">Row Color</Label><input type="color" value={tpl.table_config.rowFontColor || "#333333"} onChange={(e) => updateTC({ rowFontColor: e.target.value })} className="h-9 w-full rounded border" /></div>
              <div><Label className="text-xs">Alt Row</Label><input type="color" value={tpl.table_config.altRowColor || "#F9F9FC"} onChange={(e) => updateTC({ altRowColor: e.target.value })} className="h-9 w-full rounded border" /></div>
              <div><Label className="text-xs">Border</Label><input type="color" value={tpl.table_config.borderColor || "#E0E0E8"} onChange={(e) => updateTC({ borderColor: e.target.value })} className="h-9 w-full rounded border" /></div>
              <div className="col-span-2"><Label className="text-xs">Result Color</Label><input type="color" value={tpl.table_config.resultColor || "#ed1c23"} onChange={(e) => updateTC({ resultColor: e.target.value })} className="h-9 w-full rounded border" /></div>
            </div>
            <div>
              <Label className="text-xs">Column Widths (4 weights, e.g. 0.38,0.18,0.18,0.26)</Label>
              <Input
                value={(tpl.table_config.colWidths || [0.38,0.18,0.18,0.26]).join(",")}
                onChange={(e) => {
                  const arr = e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
                  if (arr.length === 4) updateTC({ colWidths: arr });
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Column Alignment (Test Name, Date, Result, Range)</Label>
              <div className="grid grid-cols-4 gap-2">
                {(["Test Name","Date","Result","Range"] as const).map((label, idx) => {
                  const aligns = (tpl.table_config.colAligns || ["left","center","center","center"]) as Align[];
                  return (
                    <div key={label}>
                      <Label className="text-[10px] text-muted-foreground">{label}</Label>
                      <Select
                        value={aligns[idx] || "center"}
                        onValueChange={(v) => {
                          const next = [...aligns] as Align[];
                          next[idx] = v as Align;
                          updateTC({ colAligns: next });
                        }}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer Lines */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between">Footer Lines
            <Button size="sm" variant="outline" onClick={addFooter}><Plus className="h-3 w-3 mr-1" />Add</Button>
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {tpl.footer_lines.map((f, i) => (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Textarea value={f.text} onChange={(e) => updateFooter(i, { text: e.target.value })} className="min-h-[40px]" />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeFooter(i)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-20"><Label className="text-xs">Size</Label><Input type="number" value={f.fontSize || 16} onChange={(e) => updateFooter(i, { fontSize: Number(e.target.value) })} /></div>
                  <div className="flex-1"><Label className="text-xs">Align</Label>
                    <Select value={f.align || "center"} onValueChange={(v) => updateFooter(i, { align: v as Align })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="left">Left</SelectItem><SelectItem value="center">Center</SelectItem><SelectItem value="right">Right</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <input type="color" value={f.fontColor || "#666666"} onChange={(e) => updateFooter(i, { fontColor: e.target.value })} className="h-8 w-12 rounded border self-end" />
                  <div className="flex items-center gap-1 self-end"><Switch checked={!!f.bold} onCheckedChange={(v) => updateFooter(i, { bold: v })} /><Label className="text-xs">Bold</Label></div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Saved Templates */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Saved Templates</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {templates.length === 0 && <p className="text-xs text-muted-foreground">No templates saved yet.</p>}
            {templates.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <Button variant="ghost" size="sm" className={`flex-1 justify-start text-left h-7 ${editingId === t.id ? "bg-accent" : ""}`} onClick={() => loadTemplate(t)}>
                  {t.name}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteTemplate(t.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AbnormalCardDesigner;
