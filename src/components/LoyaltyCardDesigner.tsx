import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Upload, GripVertical } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Placeholder {
  id: string;
  field: string;
  x: number;
  y: number;
  fontSize: number;
  fontColor: string;
  bold: boolean;
}

const FIELD_OPTIONS = ["Name", "Mobile", "UMR", "Discount %", "Expiry Date", "Barcode"];

const SAMPLE_DATA: Record<string, string> = {
  "Name": "JOHN DOE",
  "Mobile": "9876543210",
  "UMR": "UMR001234",
  "Discount %": "15%",
  "Expiry Date": "31-12-2026",
  "Barcode": "9876543210",
};

const BARCODE_FONT_URL = "https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap";

const LoyaltyCardDesigner = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [templateName, setTemplateName] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [bgNaturalSize, setBgNaturalSize] = useState({ w: 800, h: 500 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const { data: templates = [] } = useQuery({
    queryKey: ["loyalty_card_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("loyalty_card_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Load barcode font
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = BARCODE_FONT_URL;
    document.head.appendChild(link);
    const font = new FontFace("Libre Barcode 128", `url(https://fonts.gstatic.com/s/librebarcode128/v28/cIfnMbdUsUoiW3O_hVviCQYljbGlQMfe1ZkBg_8.woff2)`);
    font.load().then((f) => { document.fonts.add(f); drawCanvas(); });
    return () => { document.head.removeChild(link); };
  }, []);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW;
    canvas.height = displayH;

    ctx.clearRect(0, 0, displayW, displayH);

    if (backgroundUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setBgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        ctx.drawImage(img, 0, 0, displayW, displayH);
        drawPlaceholders(ctx, displayW, displayH);
      };
      img.src = backgroundUrl;
    } else {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, displayW, displayH);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Upload a background image", displayW / 2, displayH / 2);
      drawPlaceholders(ctx, displayW, displayH);
    }
  }, [backgroundUrl, placeholders, selectedId]);

  const drawPlaceholders = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    placeholders.forEach((p) => {
      const px = (p.x / 100) * cw;
      const py = (p.y / 100) * ch;
      const scaledFontSize = Math.max(10, (p.fontSize / bgNaturalSize.h) * ch);

      const fontFamily = p.field === "Barcode" ? "'Libre Barcode 128'" : "sans-serif";
      ctx.font = `${p.bold ? "bold " : ""}${scaledFontSize}px ${fontFamily}`;
      ctx.fillStyle = p.fontColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const text = p.field === "Barcode" ? (SAMPLE_DATA["Mobile"] || "0000000000") : (SAMPLE_DATA[p.field] || p.field);
      ctx.fillText(text, px, py);

      if (p.id === selectedId) {
        const metrics = ctx.measureText(text);
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(px - 2, py - 2, metrics.width + 4, scaledFontSize + 4);
        ctx.setLineDash([]);
      }
    });
  };

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    for (let i = placeholders.length - 1; i >= 0; i--) {
      const p = placeholders[i];
      const px = (p.x / 100) * cw;
      const py = (p.y / 100) * ch;
      const scaledFontSize = Math.max(10, (p.fontSize / bgNaturalSize.h) * ch);
      const textWidth = scaledFontSize * (SAMPLE_DATA[p.field]?.length || p.field.length) * 0.6;

      if (mx >= px - 5 && mx <= px + textWidth + 5 && my >= py - 5 && my <= py + scaledFontSize + 5) {
        setSelectedId(p.id);
        setDragging(p.id);
        setDragOffset({ x: mx - px, y: my - py });
        return;
      }
    }
    setSelectedId(null);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - dragOffset.x;
    const my = e.clientY - rect.top - dragOffset.y;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    setPlaceholders((prev) =>
      prev.map((p) =>
        p.id === dragging ? { ...p, x: Math.max(0, Math.min(100, (mx / cw) * 100)), y: Math.max(0, Math.min(100, (my / ch) * 100)) } : p
      )
    );
  };

  const handleCanvasMouseUp = () => setDragging(null);

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackgroundFile(file);
    setBackgroundUrl(URL.createObjectURL(file));
  };

  const addPlaceholder = () => {
    const usedFields = placeholders.map((p) => p.field);
    const nextField = FIELD_OPTIONS.find((f) => !usedFields.includes(f)) || FIELD_OPTIONS[0];
    setPlaceholders((prev) => [
      ...prev,
      { id: crypto.randomUUID(), field: nextField, x: 10, y: 10 + prev.length * 8, fontSize: 32, fontColor: "#000000", bold: false },
    ]);
  };

  const updatePlaceholder = (id: string, updates: Partial<Placeholder>) => {
    setPlaceholders((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const removePlaceholder = (id: string) => {
    setPlaceholders((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!templateName.trim()) throw new Error("Template name is required");

      let bgUrl = backgroundUrl;

      if (backgroundFile) {
        const ext = backgroundFile.name.split(".").pop();
        const path = `backgrounds/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("loyalty-cards").upload(path, backgroundFile);
        if (uploadError) throw uploadError;
        const { data: publicUrl } = supabase.storage.from("loyalty-cards").getPublicUrl(path);
        bgUrl = publicUrl.publicUrl;
      }

      const payload = {
        name: templateName,
        background_image_url: bgUrl,
        placeholders: placeholders.map(({ id, ...rest }) => rest),
      };

      if (editingTemplateId) {
        const { error } = await supabase.from("loyalty_card_templates").update(payload).eq("id", editingTemplateId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("loyalty_card_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_templates"] });
      toast({ title: editingTemplateId ? "Template updated" : "Template saved" });
      setBackgroundFile(null);
      setEditingTemplateId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const loadTemplate = (t: any) => {
    setEditingTemplateId(t.id);
    setTemplateName(t.name);
    setBackgroundUrl(t.background_image_url);
    setBackgroundFile(null);
    const phs = (t.placeholders as any[]) || [];
    setPlaceholders(phs.map((p: any) => ({ ...p, id: crypto.randomUUID() })));
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("loyalty_card_templates").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["loyalty_card_templates"] });
    if (editingTemplateId === id) {
      setEditingTemplateId(null);
      setTemplateName("");
      setBackgroundUrl(null);
      setPlaceholders([]);
    }
    toast({ title: "Template deleted" });
  };

  const selectedPlaceholder = placeholders.find((p) => p.id === selectedId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Canvas Preview */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-2">
          <Input placeholder="Template Name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="max-w-xs" />
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild><span><Upload className="h-4 w-4 mr-1" />Background</span></Button>
            <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
          </label>
          <Button size="sm" onClick={addPlaceholder}><Plus className="h-4 w-4 mr-1" />Add Field</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />{editingTemplateId ? "Update" : "Save"}
          </Button>
        </div>

        <div ref={containerRef} className="border rounded-lg overflow-hidden bg-muted" style={{ aspectRatio: `${bgNaturalSize.w}/${bgNaturalSize.h}` }}>
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          />
        </div>

        <p className="text-xs text-muted-foreground">Click a field on the canvas to select it. Drag to reposition.</p>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        {/* Placeholder Properties */}
        {selectedPlaceholder && (
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Edit: {selectedPlaceholder.field}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Field</Label>
                <Select value={selectedPlaceholder.field} onValueChange={(v) => updatePlaceholder(selectedPlaceholder.id, { field: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X (%)</Label>
                  <Input type="number" min={0} max={100} value={Math.round(selectedPlaceholder.x)} onChange={(e) => updatePlaceholder(selectedPlaceholder.id, { x: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Y (%)</Label>
                  <Input type="number" min={0} max={100} value={Math.round(selectedPlaceholder.y)} onChange={(e) => updatePlaceholder(selectedPlaceholder.id, { y: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Font Size (px on original image)</Label>
                <Input type="number" min={8} max={200} value={selectedPlaceholder.fontSize} onChange={(e) => updatePlaceholder(selectedPlaceholder.id, { fontSize: Number(e.target.value) })} />
              </div>
              <div>
                <Label className="text-xs">Font Color</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={selectedPlaceholder.fontColor} onChange={(e) => updatePlaceholder(selectedPlaceholder.id, { fontColor: e.target.value })} className="h-8 w-12 rounded border cursor-pointer" />
                  <Input value={selectedPlaceholder.fontColor} onChange={(e) => updatePlaceholder(selectedPlaceholder.id, { fontColor: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={selectedPlaceholder.bold} onCheckedChange={(v) => updatePlaceholder(selectedPlaceholder.id, { bold: v })} />
                <Label className="text-xs">Bold</Label>
              </div>
              <Button variant="destructive" size="sm" onClick={() => removePlaceholder(selectedPlaceholder.id)}>
                <Trash2 className="h-3 w-3 mr-1" />Remove
              </Button>
            </CardContent>
          </Card>
        )}

        {/* All Placeholders List */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Placeholders</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {placeholders.length === 0 && <p className="text-xs text-muted-foreground">No placeholders added yet.</p>}
            {placeholders.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer ${p.id === selectedId ? "bg-accent" : "hover:bg-accent/50"}`}
                onClick={() => setSelectedId(p.id)}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1" style={{ color: p.fontColor, fontWeight: p.bold ? "bold" : "normal" }}>{p.field}</span>
                <span className="text-xs text-muted-foreground">{p.fontSize}px</span>
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
                <Button variant="ghost" size="sm" className="flex-1 justify-start text-left h-7" onClick={() => loadTemplate(t)}>
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

export default LoyaltyCardDesigner;
