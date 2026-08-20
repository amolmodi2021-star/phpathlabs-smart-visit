import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clipboard, Image, Loader2, Plus, Trash2, FileText, ExternalLink } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { getCachedLetterheadPng } from "@/lib/reportAssetCache";
import {
  DEFAULT_SNIP_SCALE_PCT,
  DEFAULT_SNIP_TOP_MARGIN_PCT,
  clampScale,
  clampTopMargin,
  parseSnipPageScales,
  scalesRecordToArray,
} from "@/lib/snipLayout";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs`;

interface SnipOnLetterheadProps {
  regId: string;
  testId: string;
  imageUrls: string[];
  isUploading: boolean;
  onPaste: (regId: string, testId: string, event: React.ClipboardEvent) => void;
  onFileUpload: (regId: string, testId: string, file: File) => void;
  onDeletePage: (regId: string, testId: string, pageIndex: number) => void;
  /** Optional seed from parent query (avoids extra round-trip when already loaded). */
  initialPageScales?: unknown;
  initialTopMarginPct?: number | null;
}

const SnipOnLetterhead = ({
  regId, testId, imageUrls, isUploading, onPaste, onFileUpload, onDeletePage,
  initialPageScales, initialTopMarginPct,
}: SnipOnLetterheadProps) => {
  const [letterheadDataUrl, setLetterheadDataUrl] = useState<string | null>(null);
  const [loadingLetterhead, setLoadingLetterhead] = useState(true);
  const [topMarginPct, setTopMarginPct] = useState(DEFAULT_SNIP_TOP_MARGIN_PCT);
  const [topMarginInput, setTopMarginInput] = useState(String(DEFAULT_SNIP_TOP_MARGIN_PCT));
  const [pageScales, setPageScales] = useState<Record<number, number>>({});
  const [resizing, setResizing] = useState<{ pageIndex: number; startX: number; startY: number; startScale: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pasteRef = useRef<HTMLDivElement>(null);
  const layoutReadyRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyScalesFromRaw = useCallback((raw: unknown, urlCount: number) => {
    const arr = parseSnipPageScales(raw, urlCount);
    const next: Record<number, number> = {};
    arr.forEach((s, i) => { next[i] = s; });
    setPageScales(next);
  }, []);

  useEffect(() => {
    const loadLetterhead = async () => {
      setLoadingLetterhead(true);
      try {
        const { data: settings } = await supabase
          .from("report_layout_settings")
          .select("letterhead_pdf_path")
          .limit(1)
          .single();
        if (!settings?.letterhead_pdf_path) {
          setLetterheadDataUrl(null);
          setLoadingLetterhead(false);
          return;
        }
        const { data: urlData } = supabase.storage
          .from("letterheads")
          .getPublicUrl(settings.letterhead_pdf_path);
        const png = await getCachedLetterheadPng(
          settings.letterhead_pdf_path,
          urlData.publicUrl,
          async (pdfUrl) => {
            const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d")!;
            await page.render({ canvasContext: ctx, viewport }).promise;
            return canvas.toDataURL("image/png");
          },
        );
        setLetterheadDataUrl(png);
      } catch (err) {
        console.error("Failed to load letterhead:", err);
        setLetterheadDataUrl(null);
      } finally {
        setLoadingLetterhead(false);
      }
    };
    loadLetterhead();
  }, []);

  useEffect(() => {
    let cancelled = false;
    layoutReadyRef.current = false;

    const loadLayout = async () => {
      let margin = initialTopMarginPct != null && Number.isFinite(Number(initialTopMarginPct))
        ? clampTopMargin(Number(initialTopMarginPct))
        : null;
      let scalesRaw: unknown = initialPageScales ?? null;

      if (margin == null || scalesRaw == null) {
        const { data: row } = await supabase
          .from("outsourced_test_snips")
          .select("top_margin_pct, snip_page_scales")
          .eq("registration_id", regId)
          .eq("test_id", testId)
          .maybeSingle();
        if (cancelled) return;
        if (margin == null && row?.top_margin_pct != null) {
          margin = clampTopMargin(Number(row.top_margin_pct));
        }
        if (scalesRaw == null && (row as any)?.snip_page_scales != null) {
          scalesRaw = (row as any).snip_page_scales;
        }
      }

      if (margin == null) {
        const { data: marginSetting } = await supabase
          .from("app_settings")
          .select("setting_value")
          .eq("setting_key", "snip_top_margin_pct")
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (marginSetting?.setting_value) {
          margin = clampTopMargin(Number(marginSetting.setting_value));
        } else {
          margin = DEFAULT_SNIP_TOP_MARGIN_PCT;
        }
      }

      if (cancelled) return;
      setTopMarginPct(margin);
      setTopMarginInput(margin.toFixed(1));
      applyScalesFromRaw(scalesRaw, imageUrls.length);
      layoutReadyRef.current = true;
    };

    void loadLayout();
    return () => { cancelled = true; };
  }, [regId, testId, initialPageScales, initialTopMarginPct, applyScalesFromRaw, imageUrls.length]);

  useEffect(() => {
    setPageScales((prev) => {
      const next: Record<number, number> = {};
      for (let i = 0; i < imageUrls.length; i++) {
        next[i] = prev[i] != null ? clampScale(prev[i]) : DEFAULT_SNIP_SCALE_PCT;
      }
      return next;
    });
  }, [imageUrls.length]);

  const persistLayout = useCallback(async (scales: Record<number, number>, margin: number) => {
    if (!layoutReadyRef.current) return;
    const arr = scalesRecordToArray(scales, imageUrls.length);
    const { error } = await supabase
      .from("outsourced_test_snips")
      .update({
        snip_page_scales: arr,
        top_margin_pct: margin,
      } as any)
      .eq("registration_id", regId)
      .eq("test_id", testId);
    if (error) console.error("Failed to persist snip layout:", error);
  }, [regId, testId, imageUrls.length]);

  const schedulePersist = useCallback((scales: Record<number, number>, margin: number) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void persistLayout(scales, margin);
    }, 300);
  }, [persistLayout]);

  const getScale = (idx: number) => pageScales[idx] ?? DEFAULT_SNIP_SCALE_PCT;

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
      const newScale = clampScale(resizing.startScale + scaleDelta);
      setPageScales(prev => ({ ...prev, [resizing.pageIndex]: newScale }));
    };
    const handleUp = () => {
      setPageScales((prev) => {
        schedulePersist(prev, topMarginPct);
        return prev;
      });
      setResizing(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing, schedulePersist, topMarginPct]);

  const renderPageOnLetterhead = (url: string, idx: number) => {
    const scale = getScale(idx);
    return (
      <div key={idx} className="border rounded-lg overflow-hidden bg-white relative mx-auto w-full max-w-[420px]">
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
        <div className="relative w-full bg-white" style={{ aspectRatio: "210 / 297" }}>
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
          <div
            className="absolute inset-x-0 bottom-0 top-0 flex justify-center overflow-hidden pointer-events-none"
            style={{ paddingTop: `${topMarginPct}%`, paddingBottom: "6%", paddingLeft: "4%", paddingRight: "4%" }}
          >
            <div
              className="relative pointer-events-auto max-h-full"
              style={{ width: `${scale}%` }}
            >
              <img
                src={url}
                alt={`Snip page ${idx + 1}`}
                className="w-full h-auto max-h-full object-contain object-top block"
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
                  const val = clampTopMargin(Number(topMarginInput) || 0);
                  setTopMarginPct(val);
                  setTopMarginInput(val.toFixed(1));
                  schedulePersist(pageScales, val);
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

        <div className="flex justify-center bg-muted/5 p-3">
          <div
            className="relative w-full max-w-[420px] bg-white shadow-sm border rounded-sm overflow-hidden"
            style={{ aspectRatio: "210 / 297" }}
          >
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
                <div className="flex flex-col items-center gap-1.5 bg-background/80 rounded-lg p-4 mx-3 text-center">
                  <Clipboard className="h-6 w-6 text-muted-foreground" />
                  <div className="text-sm font-medium">Click here and press Ctrl+V to paste snip</div>
                  <div className="text-xs text-muted-foreground">Win+Shift+S → capture → paste here</div>
                </div>
              )}
            </div>
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
