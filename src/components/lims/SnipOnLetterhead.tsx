import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clipboard, Image, Loader2, Plus, Trash2, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface SnipOnLetterheadProps {
  regId: string;
  testId: string;
  imageUrls: string[];
  isUploading: boolean;
  onPaste: (regId: string, testId: string, event: React.ClipboardEvent) => void;
  onFileUpload: (regId: string, testId: string, file: File) => void;
  onDeletePage: (regId: string, testId: string, pageIndex: number) => void;
}

interface PageImage {
  url: string;
  scale: number;
}

const SnipOnLetterhead = ({
  regId, testId, imageUrls, isUploading, onPaste, onFileUpload, onDeletePage,
}: SnipOnLetterheadProps) => {
  const [letterheadDataUrl, setLetterheadDataUrl] = useState<string | null>(null);
  const [loadingLetterhead, setLoadingLetterhead] = useState(true);
  const [topMarginPct, setTopMarginPct] = useState(8.4);
  const [topMarginInput, setTopMarginInput] = useState("8.4");
  const [pageScales, setPageScales] = useState<Record<number, number>>({});
  const [resizing, setResizing] = useState<{ pageIndex: number; startX: number; startY: number; startScale: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pasteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadLetterhead = async () => {
      setLoadingLetterhead(true);
      try {
        const { data: settings } = await supabase
          .from("report_layout_settings")
          .select("letterhead_pdf_path, top_margin_cm")
          .limit(1)
          .single();
        if (settings?.top_margin_cm) {
          // Convert cm to percentage of A4 height (29.7cm)
          const marginPct = (Number(settings.top_margin_cm) / 29.7) * 100;
          setTopMarginPct(marginPct);
          setTopMarginInput(marginPct.toFixed(1));
        }
        if (!settings?.letterhead_pdf_path) {
          setLetterheadDataUrl(null);
          setLoadingLetterhead(false);
          return;
        }
        const { data: urlData } = supabase.storage
          .from("letterheads")
          .getPublicUrl(settings.letterhead_pdf_path);
        const pdf = await pdfjsLib.getDocument(urlData.publicUrl).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        setLetterheadDataUrl(canvas.toDataURL("image/png"));
      } catch (err) {
        console.error("Failed to load letterhead:", err);
        setLetterheadDataUrl(null);
      } finally {
        setLoadingLetterhead(false);
      }
    };
    loadLetterhead();
  }, []);

  const getScale = (idx: number) => pageScales[idx] ?? 80;

  const handleResizeStart = useCallback((e: React.MouseEvent, pageIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({
      pageIndex,
      startX: e.clientX,
      startY: e.clientY,
      startScale: getScale(pageIndex),
    });
  }, [pageScales]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - resizing.startX;
      const dy = e.clientY - resizing.startY;
      const diagonal = (dx + dy) / 2;
      const containerWidth = containerRef.current?.offsetWidth || 600;
      const scaleDelta = (diagonal / containerWidth) * 100;
      const newScale = Math.max(20, Math.min(100, resizing.startScale + scaleDelta));
      setPageScales(prev => ({ ...prev, [resizing.pageIndex]: newScale }));
    };
    const handleUp = () => setResizing(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing]);

  const renderPageOnLetterhead = (url: string, idx: number) => {
    const scale = getScale(idx);
    return (
      <div key={idx} className="border rounded-lg overflow-hidden bg-white relative">
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b">
          <span className="text-xs font-medium">Page {idx + 1}</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-2">
              {Math.round(scale)}% width
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => window.open(url, "_blank")}>
              <ExternalLink className="h-3 w-3 mr-1" /> View
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={() => onDeletePage(regId, testId, idx)}>
              <Trash2 className="h-3 w-3 mr-1" /> Remove
            </Button>
          </div>
        </div>
        <div className="relative w-full" style={{ aspectRatio: "210/297" }}>
          {letterheadDataUrl ? (
            <img
              src={letterheadDataUrl}
              alt="Letterhead"
              className="absolute inset-0 w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 border-2 border-dashed border-muted flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No letterhead uploaded</span>
            </div>
          )}
          {/* Snipped image overlay - top aligned after header margin, centered horizontally */}
          <div className="absolute left-0 right-0 top-0 flex justify-center pointer-events-none" style={{ paddingTop: `${topMarginPct}%` }}>
            <div
              className="relative inline-block pointer-events-auto"
              style={{ width: `${scale}%` }}
            >
              <img
                src={url}
                alt={`Snip page ${idx + 1}`}
                className="w-full h-auto block"
                draggable={false}
              />
              <div
                className="absolute bottom-0 right-0 w-5 h-5 bg-primary/80 rounded-tl-md cursor-nwse-resize flex items-center justify-center hover:bg-primary transition-colors z-10"
                onMouseDown={(e) => handleResizeStart(e, idx)}
                title="Drag to resize (proportional)"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-primary-foreground">
                  <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      {imageUrls.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {imageUrls.length} Page{imageUrls.length > 1 ? "s" : ""}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Top Margin %</label>
              <input
                type="text"
                value={topMarginInput}
                onChange={(e) => setTopMarginInput(e.target.value)}
                onBlur={() => {
                  const val = Math.max(0, Math.min(50, Number(topMarginInput) || 0));
                  setTopMarginPct(val);
                  setTopMarginInput(val.toFixed(1));
                }}
                className="w-16 h-7 text-xs text-center border rounded bg-background"
              />
            </div>
          </div>
          {imageUrls.map((url, idx) => renderPageOnLetterhead(url, idx))}
        </div>
      )}

      <div className="border-2 border-dashed rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 bg-muted/20 border-b border-dashed">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Plus className="h-3 w-3" />
            {imageUrls.length > 0 ? "Add Another Page" : "Add Page 1"}
          </span>
        </div>

        <div className="relative" style={{ aspectRatio: "210/297", maxHeight: "500px" }}>
          {letterheadDataUrl ? (
            <img
              src={letterheadDataUrl}
              alt="Letterhead preview"
              className="absolute inset-0 w-full h-full object-contain opacity-40"
              draggable={false}
            />
          ) : loadingLetterhead ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : null}

          <div
            ref={pasteRef}
            onPaste={(e) => onPaste(regId, testId, e)}
            tabIndex={0}
            className={`absolute inset-0 flex items-center justify-center cursor-pointer hover:bg-primary/5 transition-colors focus:ring-2 focus:ring-primary/20 focus:outline-none z-10 ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            onClick={() => pasteRef.current?.focus()}
          >
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Uploading…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 bg-background/80 rounded-lg p-4">
                <Clipboard className="h-6 w-6 text-muted-foreground" />
                <div className="text-sm font-medium">Click here and press Ctrl+V to paste snip</div>
                <div className="text-xs text-muted-foreground">Win+Shift+S → capture → paste here</div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 py-2">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 border-t" />
        </div>
        <div className="flex justify-center pb-4">
          <label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload(regId, testId, file);
            }} />
            <Button variant="outline" size="sm" asChild>
              <span><Image className="h-3.5 w-3.5 mr-1" /> Browse Image</span>
            </Button>
          </label>
        </div>
      </div>
    </div>
  );
};

export default SnipOnLetterhead;
