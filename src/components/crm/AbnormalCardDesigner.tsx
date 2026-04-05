import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Upload, GripVertical, Image } from "lucide-react";

/* ───── types ───── */
interface Placeholder {
  id: string;
  field: string;
  x: number;
  y: number;
  fontSize: number;
  fontColor: string;
  bold: boolean;
}

interface TableConfig {
  headerBg: string;
  headerFont: string;
  headerFontSize: number;
  headerFontColor: string;
  rowFontSize: number;
  rowFontColor: string;
  resultColor: string;
  borderColor: string;
  altRowColor: string;
  rowHeight: number;
  colWidths: number[]; // 4 column widths as fractions summing to 1
}

interface FooterLine {
  id: string;
  text: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  align: "left" | "center" | "right";
}

interface Band {
  id: string;
  label: string;
  height: number;
  color: string;
  textColor: string;
  text: string;
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
  position: "above-table" | "below-table";
}

const FIELD_OPTIONS = ["Name", "Mobile", "UMR", "Barcode"];

const SAMPLE_DATA: Record<string, string> = {
  Name: "JOHN DOE",
  Mobile: "9876543210",
  UMR: "UMR001234",
  Barcode: "9876543210",
};

const SAMPLE_TESTS = [
  { test_name: "Haemoglobin", test_date: "15-01-2026", result_value: "9.2", normal_range: "12.0 - 16.0" },
  { test_name: "Platelet Count", test_date: "15-01-2026", result_value: "90000", normal_range: "150000 - 400000" },
  { test_name: "Blood Sugar (F)", test_date: "15-01-2026", result_value: "210", normal_range: "70 - 110" },
];

const DEFAULT_TABLE: TableConfig = {
  headerBg: "#2E3192",
  headerFont: "Arial",
  headerFontSize: 15,
  headerFontColor: "#FFFFFF",
  rowFontSize: 14,
  rowFontColor: "#333333",
  resultColor: "#CC0000",
  borderColor: "#E0E0E8",
  altRowColor: "#F9F9FC",
  rowHeight: 36,
  colWidths: [0.38, 0.18, 0.18, 0.26],
};

/* ───── Barcode Code128C (from cardRenderer.ts) ───── */
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

function drawBarcode(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, height: number, color: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return;
  const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`;
  const codes = [105 as number];
  for (let i = 0; i < evenDigits.length; i += 2) codes.push(Number(evenDigits.slice(i, i + 2)));
  let checksum = 105;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(106);
  const patterns = codes.map((code) => CODE128_PATTERNS[code]).filter(Boolean);
  const totalModules = patterns.reduce((sum, p) => sum + p.split("").reduce((acc, w) => acc + Number(w), 0), 0);
  const targetWidth = Math.max(evenDigits.length * height * 0.38, height * 2.8);
  const moduleWidth = targetWidth / totalModules;
  ctx.save();
  ctx.fillStyle = color;
  let cursorX = x;
  for (const pattern of patterns) {
    pattern.split("").forEach((seg, idx) => {
      const width = Number(seg) * moduleWidth;
      if (idx % 2 === 0) ctx.fillRect(cursorX, y, width, height);
      cursorX += width;
    });
  }
  ctx.restore();
}

/* ───── Component ───── */
const AbnormalCardDesigner = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [templateName, setTemplateName] = useState("Default");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Global
  const [canvasWidth, setCanvasWidth] = useState(900);
  const [bgColor, setBgColor] = useState("#FFFFFF");
  const [headerBgColor, setHeaderBgColor] = useState("#2E3192");
  const [headerFontColor, setHeaderFontColor] = useState("#FFFFFF");
  const [headerBandHeight, setHeaderBandHeight] = useState(160);
  const [showHeaderBand, setShowHeaderBand] = useState(true);

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoW, setLogoW] = useState(120);
  const [logoH, setLogoH] = useState(60);
  const [logoX, setLogoX] = useState(2);
  const [logoY, setLogoY] = useState(2);

  // Header placeholders
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([
    { id: crypto.randomUUID(), field: "Name", x: 4.5, y: 38, fontSize: 20, fontColor: "#FFFFFF", bold: true },
    { id: crypto.randomUUID(), field: "Mobile", x: 4.5, y: 52, fontSize: 16, fontColor: "#FFFFFF", bold: false },
    { id: crypto.randomUUID(), field: "UMR", x: 50, y: 52, fontSize: 16, fontColor: "#FFFFFF", bold: false },
  ]);

  // Bands
  const [bands, setBands] = useState<Band[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Table
  const [tableConfig, setTableConfig] = useState<TableConfig>({ ...DEFAULT_TABLE });

  // Footer
  const [footerLines, setFooterLines] = useState<FooterLine[]>([
    { id: crypto.randomUUID(), text: "LabLine: 1800-XXX-XXXX", fontSize: 14, fontColor: "#2E3192", bold: true, align: "center" },
    { id: crypto.randomUUID(), text: "Mon-Sat: 7AM - 9PM | Sun: 8AM - 2PM", fontSize: 12, fontColor: "#666666", bold: false, align: "center" },
    { id: crypto.randomUUID(), text: "123, Main Road, City - 380001", fontSize: 12, fontColor: "#666666", bold: false, align: "center" },
  ]);

  // Dragging
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOff, setDragOff] = useState({ x: 0, y: 0 });

  // Computed canvas height
  const headerHeight = showHeaderBand ? headerBandHeight : 0;
  const padding = 40;
  const tableHeaderH = 40;
  const tableRowsH = SAMPLE_TESTS.length * tableConfig.rowHeight;
  const bandsAboveH = bands.filter(b => b.position === "above-table").reduce((s, b) => s + b.height, 0);
  const bandsBelowH = bands.filter(b => b.position === "below-table").reduce((s, b) => s + b.height, 0);
  const footerH = footerLines.reduce((s, l) => s + l.fontSize + 8, 0) + 20;
  const totalHeight = headerHeight + bandsAboveH + tableHeaderH + tableRowsH + bandsBelowH + footerH + padding * 2;

  // Logo image element
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!logoUrl) { setLogoImg(null); return; }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setLogoImg(img);
    img.src = logoUrl;
  }, [logoUrl]);

  /* ─── Draw canvas ─── */
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvasWidth;
    canvas.height = totalHeight;

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasWidth, totalHeight);

    // Header band
    if (showHeaderBand) {
      ctx.fillStyle = headerBgColor;
      ctx.fillRect(0, 0, canvasWidth, headerHeight);
    }

    // Logo
    if (logoImg) {
      const lx = (logoX / 100) * canvasWidth;
      const ly = (logoY / 100) * headerHeight;
      ctx.drawImage(logoImg, lx, ly, logoW, logoH);
    }

    // Placeholders
    placeholders.forEach((p) => {
      const px = (p.x / 100) * canvasWidth;
      const py = (p.y / 100) * totalHeight;

      if (p.field === "Barcode") {
        drawBarcode(ctx, SAMPLE_DATA.Mobile, px, py, p.fontSize, p.fontColor);
      } else {
        ctx.font = `${p.bold ? "bold " : ""}${p.fontSize}px Arial, Helvetica, sans-serif`;
        ctx.fillStyle = p.fontColor;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const label = p.field === "Name" ? SAMPLE_DATA.Name : p.field === "Mobile" ? `Mobile: ${SAMPLE_DATA.Mobile}` : `UMR: ${SAMPLE_DATA.UMR}`;
        ctx.fillText(label, px, py);
      }

      if (p.id === selectedId) {
        const metrics = ctx.measureText(SAMPLE_DATA[p.field] || p.field);
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(px - 2, py - 2, metrics.width + 4, p.fontSize + 4);
        ctx.setLineDash([]);
      }
    });

    // Helper to draw a band
    const drawBand = (ctx: CanvasRenderingContext2D, band: Band, y: number) => {
      ctx.fillStyle = band.color;
      ctx.fillRect(0, y, canvasWidth, band.height);
      if (band.text) {
        ctx.fillStyle = band.textColor;
        ctx.font = `${band.bold ? "bold " : ""}${band.fontSize}px Arial, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = band.align === "center" ? "center" : band.align === "right" ? "right" : "left";
        const tx = band.align === "center" ? canvasWidth / 2 : band.align === "right" ? canvasWidth - padding : padding;
        ctx.fillText(band.text, tx, y + band.height / 2);
      }
    };

    // Bands above table
    let cursorY = headerHeight;
    bands.filter(b => b.position === "above-table").forEach((b) => {
      drawBand(ctx, b, cursorY);
      cursorY += b.height;
    });

    // Table
    const tableY = cursorY + 10;
    const tableW = canvasWidth - padding * 2;
    const tc = tableConfig;
    const colStarts = [0, tc.colWidths[0], tc.colWidths[0] + tc.colWidths[1], tc.colWidths[0] + tc.colWidths[1] + tc.colWidths[2]].map(
      (f) => padding + f * tableW + 10
    );

    // Table header
    ctx.fillStyle = tc.headerBg;
    ctx.fillRect(padding, tableY, tableW, tableHeaderH);
    ctx.fillStyle = tc.headerFontColor;
    ctx.font = `bold ${tc.headerFontSize}px ${tc.headerFont}, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("Test Name", colStarts[0], tableY + 12);
    ctx.fillText("Date", colStarts[1], tableY + 12);
    ctx.fillText("Result", colStarts[2], tableY + 12);
    ctx.fillText("Normal Range", colStarts[3], tableY + 12);

    // Table rows
    SAMPLE_TESTS.forEach((t, i) => {
      const y = tableY + tableHeaderH + i * tc.rowHeight;
      if (i % 2 === 1) {
        ctx.fillStyle = tc.altRowColor;
        ctx.fillRect(padding, y, tableW, tc.rowHeight);
      }
      ctx.strokeStyle = tc.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y + tc.rowHeight);
      ctx.lineTo(padding + tableW, y + tc.rowHeight);
      ctx.stroke();

      ctx.fillStyle = tc.rowFontColor;
      ctx.font = `${tc.rowFontSize}px Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(t.test_name, colStarts[0], y + 10);
      ctx.fillText(t.test_date, colStarts[1], y + 10);

      ctx.fillStyle = tc.resultColor;
      ctx.font = `bold ${tc.rowFontSize}px Arial, sans-serif`;
      ctx.fillText(t.result_value, colStarts[2], y + 10);

      ctx.fillStyle = tc.rowFontColor;
      ctx.font = `${tc.rowFontSize}px Arial, sans-serif`;
      ctx.fillText(t.normal_range, colStarts[3], y + 10);
    });

    // Table border
    ctx.strokeStyle = tc.headerBg;
    ctx.lineWidth = 2;
    ctx.strokeRect(padding, tableY, tableW, tableHeaderH + tableRowsH);

    // Bands below table
    let belowY = tableY + tableHeaderH + tableRowsH + 10;
    bands.filter(b => b.position === "below-table").forEach((b) => {
      drawBand(ctx, b, belowY);
      belowY += b.height;
    });

    // Footer
    let fy = belowY + 10;
    footerLines.forEach((fl) => {
      ctx.fillStyle = fl.fontColor;
      ctx.font = `${fl.bold ? "bold " : ""}${fl.fontSize}px Arial, sans-serif`;
      ctx.textAlign = fl.align === "center" ? "center" : fl.align === "right" ? "right" : "left";
      const fx = fl.align === "center" ? canvasWidth / 2 : fl.align === "right" ? canvasWidth - padding : padding;
      ctx.fillText(fl.text, fx, fy);
      fy += fl.fontSize + 8;
    });
    ctx.textAlign = "left";
  }, [canvasWidth, bgColor, headerBgColor, headerFontColor, showHeaderBand, headerBandHeight, logoImg, logoW, logoH, logoX, logoY, placeholders, selectedId, tableConfig, footerLines, bands, totalHeight]);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  /* ─── Canvas interaction ─── */
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    for (let i = placeholders.length - 1; i >= 0; i--) {
      const p = placeholders[i];
      const px = (p.x / 100) * canvasWidth;
      const py = (p.y / 100) * headerHeight;
      const w = p.fontSize * 12;
      const h = p.fontSize + 6;
      if (mx >= px - 5 && mx <= px + w && my >= py - 5 && my <= py + h) {
        setSelectedId(p.id);
        setDragging(p.id);
        setDragOff({ x: mx - px, y: my - py });
        return;
      }
    }
    setSelectedId(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX - dragOff.x;
    const my = (e.clientY - rect.top) * scaleY - dragOff.y;

    setPlaceholders((prev) =>
      prev.map((p) =>
        p.id === dragging
          ? { ...p, x: Math.max(0, Math.min(100, (mx / canvasWidth) * 100)), y: Math.max(0, Math.min(100, (my / headerHeight) * 100)) }
          : p
      )
    );
  };

  const handleMouseUp = () => setDragging(null);

  /* ─── Logo upload ─── */
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoUrl(URL.createObjectURL(file));
  };

  /* ─── Placeholder CRUD ─── */
  const addPlaceholder = () => {
    const used = placeholders.map((p) => p.field);
    const next = FIELD_OPTIONS.find((f) => !used.includes(f)) || FIELD_OPTIONS[0];
    setPlaceholders((prev) => [
      ...prev,
      { id: crypto.randomUUID(), field: next, x: 4.5, y: 70 + prev.length * 8, fontSize: 16, fontColor: "#FFFFFF", bold: false },
    ]);
  };

  const updatePH = (id: string, u: Partial<Placeholder>) => setPlaceholders((prev) => prev.map((p) => (p.id === id ? { ...p, ...u } : p)));
  const removePH = (id: string) => { setPlaceholders((p) => p.filter((x) => x.id !== id)); if (selectedId === id) setSelectedId(null); };

  /* ─── Band CRUD ─── */
  const addBand = () => setBands((prev) => [...prev, { id: crypto.randomUUID(), label: `Band ${prev.length + 1}`, height: 40, color: "#2E3192", textColor: "#FFFFFF", text: "", fontSize: 14, bold: false, align: "center", position: "above-table" }]);
  const updateBand = (id: string, u: Partial<Band>) => setBands((prev) => prev.map((b) => (b.id === id ? { ...b, ...u } : b)));
  const removeBand = (id: string) => setBands((prev) => prev.filter((b) => b.id !== id));

  /* ─── Footer CRUD ─── */
  const addFooterLine = () => setFooterLines((prev) => [...prev, { id: crypto.randomUUID(), text: "New line", fontSize: 12, fontColor: "#666666", bold: false, align: "center" }]);
  const updateFL = (id: string, u: Partial<FooterLine>) => setFooterLines((prev) => prev.map((f) => (f.id === id ? { ...f, ...u } : f)));
  const removeFL = (id: string) => setFooterLines((prev) => prev.filter((f) => f.id !== id));

  /* ─── Save / Load / Delete ─── */
  const { data: templates = [] } = useQuery({
    queryKey: ["abnormal-card-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("abnormal_card_templates").select("*").order("created_at", { ascending: false });
      return (data as any[]) || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!templateName.trim()) throw new Error("Template name required");

      let finalLogoUrl = logoUrl;
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `logos/abnormal_${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("loyalty-cards").upload(path, logoFile);
        if (error) throw error;
        finalLogoUrl = supabase.storage.from("loyalty-cards").getPublicUrl(path).data.publicUrl;
      }

      const payload = {
        name: templateName,
        logo_url: finalLogoUrl,
        logo_width: logoW,
        logo_height: logoH,
        logo_x: logoX,
        logo_y: logoY,
        background_color: bgColor,
        header_bg_color: headerBgColor,
        header_font_color: headerFontColor,
        header_band_height: headerBandHeight,
        show_header_band: showHeaderBand,
        canvas_width: canvasWidth,
        placeholders: JSON.parse(JSON.stringify(placeholders.map(({ id, ...rest }) => rest))),
        table_config: JSON.parse(JSON.stringify(tableConfig)),
        footer_lines: JSON.parse(JSON.stringify(footerLines.map(({ id, ...rest }) => rest))),
        bands: JSON.parse(JSON.stringify(bands.map(({ id, ...rest }) => rest))),
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
      qc.invalidateQueries({ queryKey: ["abnormal-card-templates"] });
      toast({ title: editingId ? "Template updated" : "Template saved" });
      setLogoFile(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const loadTemplate = (t: any) => {
    setEditingId(t.id);
    setTemplateName(t.name);
    setLogoUrl(t.logo_url);
    setLogoFile(null);
    setLogoW(t.logo_width || 120);
    setLogoH(t.logo_height || 60);
    setLogoX(t.logo_x ?? 2);
    setLogoY(t.logo_y ?? 2);
    setBgColor(t.background_color || "#FFFFFF");
    setHeaderBgColor(t.header_bg_color || "#2E3192");
    setHeaderFontColor(t.header_font_color || "#FFFFFF");
    setHeaderBandHeight(t.header_band_height ?? 160);
    setShowHeaderBand(t.show_header_band !== false);
    setCanvasWidth(t.canvas_width || 900);
    const phs = (t.placeholders as any[]) || [];
    setPlaceholders(phs.map((p: any) => ({ ...p, id: crypto.randomUUID() })));
    const tc = (t.table_config as any) || {};
    setTableConfig({ ...DEFAULT_TABLE, ...tc });
    const fls = (t.footer_lines as any[]) || [];
    setFooterLines(fls.map((f: any) => ({ ...f, id: crypto.randomUUID() })));
    const bds = (t.bands as any[]) || [];
    setBands(bds.map((b: any) => ({ ...b, id: crypto.randomUUID() })));
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("abnormal_card_templates").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["abnormal-card-templates"] });
    if (editingId === id) { setEditingId(null); setTemplateName("Default"); }
    toast({ title: "Template deleted" });
  };

  const selectedPH = placeholders.find((p) => p.id === selectedId);

  /* ─── Render ─── */
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left: Canvas */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Input placeholder="Template Name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="max-w-xs" />
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild><span><Upload className="h-4 w-4 mr-1" />Logo</span></Button>
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
          <Button size="sm" onClick={addPlaceholder}><Plus className="h-4 w-4 mr-1" />Field</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />{editingId ? "Update" : "Save"}
          </Button>
        </div>

        <div className="border rounded-lg overflow-auto bg-muted" style={{ maxHeight: "70vh" }}>
          <canvas
            ref={canvasRef}
            className="cursor-crosshair"
            style={{ width: "100%", height: "auto" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
        <p className="text-xs text-muted-foreground">Drag header fields to reposition. Table & footer are auto-positioned.</p>
      </div>

      {/* Right: Properties */}
      <div className="space-y-3 max-h-[80vh] overflow-auto">
        <Tabs defaultValue="global">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="bands">Bands</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="footer">Footer</TabsTrigger>
            <TabsTrigger value="templates">Saved</TabsTrigger>
          </TabsList>

          {/* Global */}
          <TabsContent value="global" className="space-y-3">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <Label className="text-xs">Canvas Width</Label>
                  <Input type="number" min={600} max={1200} value={canvasWidth} onChange={(e) => setCanvasWidth(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Background Color</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="flex-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Header Band Settings */}
            <Card>
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Header Band</CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Show</Label>
                  <Switch checked={showHeaderBand} onCheckedChange={setShowHeaderBand} />
                </div>
              </CardHeader>
              {showHeaderBand && (
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Height (px)</Label>
                    <Input type="number" min={40} max={400} value={headerBandHeight} onChange={(e) => setHeaderBandHeight(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label className="text-xs">Band Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={headerBgColor} onChange={(e) => setHeaderBgColor(e.target.value)} className="h-8 w-12 rounded border cursor-pointer" />
                      <Input value={headerBgColor} onChange={(e) => setHeaderBgColor(e.target.value)} className="flex-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Font Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={headerFontColor} onChange={(e) => setHeaderFontColor(e.target.value)} className="h-8 w-12 rounded border cursor-pointer" />
                      <Input value={headerFontColor} onChange={(e) => setHeaderFontColor(e.target.value)} className="flex-1" />
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Logo settings */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Logo Settings</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {logoUrl ? (
                  <div className="flex items-center gap-2">
                    <img src={logoUrl} alt="Logo" className="h-10 object-contain border rounded" />
                    <Button variant="ghost" size="sm" onClick={() => { setLogoUrl(null); setLogoFile(null); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No logo uploaded</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Width</Label><Input type="number" min={20} max={400} value={logoW} onChange={(e) => setLogoW(Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Height</Label><Input type="number" min={20} max={200} value={logoH} onChange={(e) => setLogoH(Number(e.target.value))} /></div>
                  <div><Label className="text-xs">X (%)</Label><Input type="number" min={0} max={100} value={logoX} onChange={(e) => setLogoX(Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Y (%)</Label><Input type="number" min={0} max={100} value={logoY} onChange={(e) => setLogoY(Number(e.target.value))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fields */}
          <TabsContent value="fields" className="space-y-3">
            {selectedPH && (
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm">Edit: {selectedPH.field}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Field</Label>
                    <Select value={selectedPH.field} onValueChange={(v) => updatePH(selectedPH.id, { field: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">X (%)</Label><Input type="number" min={0} max={100} value={Math.round(selectedPH.x)} onChange={(e) => updatePH(selectedPH.id, { x: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Y (%)</Label><Input type="number" min={0} max={100} value={Math.round(selectedPH.y)} onChange={(e) => updatePH(selectedPH.id, { y: Number(e.target.value) })} /></div>
                  </div>
                  <div><Label className="text-xs">Font Size</Label><Input type="number" min={8} max={60} value={selectedPH.fontSize} onChange={(e) => updatePH(selectedPH.id, { fontSize: Number(e.target.value) })} /></div>
                  <div>
                    <Label className="text-xs">Font Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={selectedPH.fontColor} onChange={(e) => updatePH(selectedPH.id, { fontColor: e.target.value })} className="h-8 w-12 rounded border cursor-pointer" />
                      <Input value={selectedPH.fontColor} onChange={(e) => updatePH(selectedPH.id, { fontColor: e.target.value })} className="flex-1" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={selectedPH.bold} onCheckedChange={(v) => updatePH(selectedPH.id, { bold: v })} />
                    <Label className="text-xs">Bold</Label>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => removePH(selectedPH.id)}><Trash2 className="h-3 w-3 mr-1" />Remove</Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Header Fields</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {placeholders.length === 0 && <p className="text-xs text-muted-foreground">No fields added.</p>}
                {placeholders.map((p) => (
                  <div key={p.id} className={`flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer ${p.id === selectedId ? "bg-accent" : "hover:bg-accent/50"}`} onClick={() => setSelectedId(p.id)}>
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1" style={{ color: p.fontColor, fontWeight: p.bold ? "bold" : "normal" }}>{p.field}</span>
                    <span className="text-xs text-muted-foreground">{p.fontSize}px</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bands */}
          <TabsContent value="bands" className="space-y-3">
            <Card>
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Bands</CardTitle>
                <Button size="sm" variant="outline" onClick={addBand}><Plus className="h-3 w-3 mr-1" />Add Band</Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {bands.length === 0 && <p className="text-xs text-muted-foreground">No bands added. Bands are colored horizontal strips above or below the table.</p>}
                {bands.map((band, i) => (
                  <div key={band.id} className="border rounded p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Band {i + 1}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => removeBand(band.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    <div>
                      <Label className="text-xs">Position</Label>
                      <Select value={band.position} onValueChange={(v) => updateBand(band.id, { position: v as Band["position"] })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="above-table">Above Table</SelectItem>
                          <SelectItem value="below-table">Below Table</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Height (px)</Label>
                      <Input type="number" min={10} max={200} value={band.height} onChange={(e) => updateBand(band.id, { height: Number(e.target.value) })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Band Color</Label>
                        <div className="flex gap-1 items-center">
                          <input type="color" value={band.color} onChange={(e) => updateBand(band.id, { color: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                          <Input value={band.color} onChange={(e) => updateBand(band.id, { color: e.target.value })} className="flex-1" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Text Color</Label>
                        <div className="flex gap-1 items-center">
                          <input type="color" value={band.textColor} onChange={(e) => updateBand(band.id, { textColor: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                          <Input value={band.textColor} onChange={(e) => updateBand(band.id, { textColor: e.target.value })} className="flex-1" />
                        </div>
                      </div>
                    </div>
                    <Input value={band.text} onChange={(e) => updateBand(band.id, { text: e.target.value })} placeholder="Band text (optional)" />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs">Font Size</Label><Input type="number" min={8} max={30} value={band.fontSize} onChange={(e) => updateBand(band.id, { fontSize: Number(e.target.value) })} /></div>
                      <div>
                        <Label className="text-xs">Align</Label>
                        <Select value={band.align} onValueChange={(v) => updateBand(band.id, { align: v as "left" | "center" | "right" })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Left</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="right">Right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end pb-1">
                        <div className="flex items-center gap-1">
                          <Switch checked={band.bold} onCheckedChange={(v) => updateBand(band.id, { bold: v })} />
                          <Label className="text-xs">Bold</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Table */}
          <TabsContent value="table" className="space-y-3">
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Table Styling</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Header Background</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={tableConfig.headerBg} onChange={(e) => setTableConfig((tc) => ({ ...tc, headerBg: e.target.value }))} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={tableConfig.headerBg} onChange={(e) => setTableConfig((tc) => ({ ...tc, headerBg: e.target.value }))} className="flex-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Header Font Size</Label><Input type="number" min={10} max={24} value={tableConfig.headerFontSize} onChange={(e) => setTableConfig((tc) => ({ ...tc, headerFontSize: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">Row Font Size</Label><Input type="number" min={10} max={24} value={tableConfig.rowFontSize} onChange={(e) => setTableConfig((tc) => ({ ...tc, rowFontSize: Number(e.target.value) }))} /></div>
                </div>
                <div><Label className="text-xs">Row Height</Label><Input type="number" min={24} max={60} value={tableConfig.rowHeight} onChange={(e) => setTableConfig((tc) => ({ ...tc, rowHeight: Number(e.target.value) }))} /></div>
                <div>
                  <Label className="text-xs">Result Highlight Color</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={tableConfig.resultColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, resultColor: e.target.value }))} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={tableConfig.resultColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, resultColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Border Color</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={tableConfig.borderColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, borderColor: e.target.value }))} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={tableConfig.borderColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, borderColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Alt Row Color</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={tableConfig.altRowColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, altRowColor: e.target.value }))} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={tableConfig.altRowColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, altRowColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Row Text Color</Label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={tableConfig.rowFontColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, rowFontColor: e.target.value }))} className="h-8 w-12 rounded border cursor-pointer" />
                    <Input value={tableConfig.rowFontColor} onChange={(e) => setTableConfig((tc) => ({ ...tc, rowFontColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Footer */}
          <TabsContent value="footer" className="space-y-3">
            <Card>
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Footer Lines</CardTitle>
                <Button size="sm" variant="outline" onClick={addFooterLine}><Plus className="h-3 w-3 mr-1" />Add</Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {footerLines.map((fl, i) => (
                  <div key={fl.id} className="border rounded p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Line {i + 1}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => removeFL(fl.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    <Input value={fl.text} onChange={(e) => updateFL(fl.id, { text: e.target.value })} placeholder="Text" />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs">Size</Label><Input type="number" min={8} max={30} value={fl.fontSize} onChange={(e) => updateFL(fl.id, { fontSize: Number(e.target.value) })} /></div>
                      <div>
                        <Label className="text-xs">Color</Label>
                        <input type="color" value={fl.fontColor} onChange={(e) => updateFL(fl.id, { fontColor: e.target.value })} className="h-8 w-full rounded border cursor-pointer" />
                      </div>
                      <div>
                        <Label className="text-xs">Align</Label>
                        <Select value={fl.align} onValueChange={(v) => updateFL(fl.id, { align: v as "left" | "center" | "right" })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Left</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="right">Right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={fl.bold} onCheckedChange={(v) => updateFL(fl.id, { bold: v })} />
                      <Label className="text-xs">Bold</Label>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Templates */}
          <TabsContent value="templates" className="space-y-3">
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Saved Templates</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {templates.length === 0 && <p className="text-xs text-muted-foreground">No templates saved yet.</p>}
                {templates.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <Button variant="ghost" size="sm" className="flex-1 justify-start text-left h-7" onClick={() => loadTemplate(t)}>{t.name}</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AbnormalCardDesigner;
