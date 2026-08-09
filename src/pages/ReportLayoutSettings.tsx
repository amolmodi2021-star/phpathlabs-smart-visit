import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Upload, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

const ReportLayoutSettings = () => {
  const navigate = useNavigate();
  const [topMargin, setTopMargin] = useState(2.5);
  const [bottomMargin, setBottomMargin] = useState(1.5);
  const [letterheadPath, setLetterheadPath] = useState<string | null>(null);
  const [letterheadPreviewUrl, setLetterheadPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const revokePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setLetterheadPreviewUrl(null);
  };

  /** Download from storage and build a PDF blob URL so the browser previews
   *  instead of auto-downloading (storage often serves application/octet-stream). */
  const loadPreview = async (path: string) => {
    revokePreview();
    const { data, error } = await supabase.storage.from("letterheads").download(path);
    if (error || !data) {
      toast.error("Could not load letterhead preview");
      return;
    }
    const pdfBlob =
      data.type === "application/pdf"
        ? data
        : new Blob([await data.arrayBuffer()], { type: "application/pdf" });
    const url = URL.createObjectURL(pdfBlob);
    previewUrlRef.current = url;
    setLetterheadPreviewUrl(url);
  };

  useEffect(() => {
    loadSettings();
    return () => revokePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase.from("report_layout_settings").select("*").limit(1).single();
    if (data) {
      setSettingsId(data.id);
      setTopMargin(Number(data.top_margin_cm) || 2.5);
      setBottomMargin(Number(data.bottom_margin_cm) || 1.5);
      setLetterheadPath(data.letterhead_pdf_path || null);
      if (data.letterhead_pdf_path) {
        await loadPreview(data.letterhead_pdf_path);
      }
    }
  };

  const handleUploadLetterhead = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }
    setUploading(true);
    const fileName = `letterhead_${Date.now()}.pdf`;

    if (letterheadPath) {
      await supabase.storage.from("letterheads").remove([letterheadPath]);
    }

    const { error } = await supabase.storage.from("letterheads").upload(fileName, file, {
      upsert: true,
      contentType: "application/pdf",
      cacheControl: "3600",
    });
    if (error) {
      toast.error("Upload failed: " + error.message);
      setUploading(false);
      return;
    }
    setLetterheadPath(fileName);
    await loadPreview(fileName);
    toast.success("Letterhead uploaded");
    setUploading(false);
    e.target.value = "";
  };

  const handleRemoveLetterhead = async () => {
    if (letterheadPath) {
      await supabase.storage.from("letterheads").remove([letterheadPath]);
    }
    setLetterheadPath(null);
    revokePreview();
    toast.success("Letterhead removed");
  };

  const handleSave = async () => {
    setSaving(true);
    const updateData = {
      top_margin_cm: topMargin,
      bottom_margin_cm: bottomMargin,
      letterhead_pdf_path: letterheadPath,
      updated_at: new Date().toISOString(),
    };

    if (settingsId) {
      await supabase.from("report_layout_settings").update(updateData).eq("id", settingsId);
    } else {
      await supabase.from("report_layout_settings").insert(updateData);
    }
    toast.success("Layout settings saved");
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <h1 className="text-2xl font-bold">Report Layout Settings</h1>
      </div>

      <div className="grid gap-6 max-w-xl">
        {/* Margins */}
        <div className="bg-card border rounded-lg p-6 space-y-6">
          <h2 className="text-lg font-semibold">Page Margins</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Top Margin</Label>
              <span className="text-sm font-mono font-semibold">{topMargin.toFixed(1)} cm</span>
            </div>
            <Slider
              value={[topMargin]}
              onValueChange={([v]) => setTopMargin(v)}
              min={0}
              max={10}
              step={0.1}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Bottom Margin</Label>
              <span className="text-sm font-mono font-semibold">{bottomMargin.toFixed(1)} cm</span>
            </div>
            <Slider
              value={[bottomMargin]}
              onValueChange={([v]) => setBottomMargin(v)}
              min={0}
              max={10}
              step={0.1}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Top (cm)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={topMargin}
                onChange={(e) => setTopMargin(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Bottom (cm)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={bottomMargin}
                onChange={(e) => setBottomMargin(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Letterhead Upload */}
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Letterhead Background (PDF)</h2>
          <p className="text-sm text-muted-foreground">
            Upload a PDF to use as background when printing reports. This will be rendered behind your report content.
          </p>

          {letterheadPath ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-muted rounded-lg p-3">
                <div className="flex-1 text-sm font-medium truncate">{letterheadPath}</div>
                <Button variant="destructive" size="sm" onClick={handleRemoveLetterhead}>
                  <Trash2 className="h-4 w-4 mr-1" />Remove
                </Button>
              </div>
              {letterheadPreviewUrl ? (
                <iframe
                  src={`${letterheadPreviewUrl}#toolbar=0&navpanes=0`}
                  className="w-full h-[400px] border rounded bg-white"
                  title="Letterhead Preview"
                />
              ) : (
                <div className="w-full h-[120px] border rounded flex items-center justify-center text-sm text-muted-foreground">
                  Loading preview…
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/50 transition-colors">
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {uploading ? "Uploading..." : "Click to upload PDF letterhead"}
                </span>
                <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleUploadLetterhead} disabled={uploading} />
              </label>
            </div>
          )}
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Saving..." : "Save Layout Settings"}
        </Button>
      </div>
    </div>
  );
};

export default ReportLayoutSettings;
