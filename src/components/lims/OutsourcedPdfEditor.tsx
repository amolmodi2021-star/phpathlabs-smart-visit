import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Save, Trash2, FileText, ChevronLeft, ChevronRight, Image } from "lucide-react";
import { toast } from "sonner";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";
import {
  parsePdfCropRegions,
  renderCropToPng,
  type ComposePatientMeta,
  type PdfCropRegion,
} from "@/lib/outsourcedPdfCompose";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs`;

type Props = {
  regId: string;
  testId: string;
  testName: string;
  patientMeta: ComposePatientMeta;
  existingSourcePdfUrl?: string | null;
  existingCrops?: unknown;
  existingComposedPdfUrl?: string | null;
  existingSnipUrls?: string[];
  isSaving?: boolean;
  onSaved: (payload: {
    sourcePdfUrl: string;
    sourcePdfPublicId: string;
    cropRegions: PdfCropRegion[];
    snipImageUrls: string[];
  }) => Promise<void>;
};

type DragBox = { x0: number; y0: number; x1: number; y1: number } | null;

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] || "image/png";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function OutsourcedPdfEditor({
  regId, testId, testName, patientMeta: _patientMeta,
  existingSourcePdfUrl, existingCrops, existingSnipUrls,
  isSaving, onSaved,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState(existingSourcePdfUrl || "");
  const [sourcePublicId, setSourcePublicId] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCanvasUrl, setPageCanvasUrl] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [crops, setCrops] = useState<PdfCropRegion[]>(() => parsePdfCropRegions(existingCrops));
  const [drag, setDrag] = useState<DragBox>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>(existingSnipUrls || []);
  const wrapRef = useRef<HTMLDivElement>(null);

  const renderPage = useCallback(async (url: string, idx: number) => {
    setLoadingPage(true);
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      setPageCount(pdf.numPages);
      const page = await pdf.getPage(idx + 1);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setPageCanvasUrl(canvas.toDataURL("image/png"));
    } catch (e: any) {
      toast.error(e?.message || "Failed to render PDF page");
      setPageCanvasUrl(null);
    } finally {
      setLoadingPage(false);
    }
  }, []);

  useEffect(() => {
    if (sourceUrl) void renderPage(sourceUrl, pageIndex);
  }, [sourceUrl, pageIndex, renderPage]);

  const uploadPdf = async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadBlobToCloudinary(file, {
        resourceType: "auto",
        purpose: "outsourced_pdf",
        folder: "outsourced-lab-pdfs",
        publicId: `${regId}_${testId}_${Date.now()}`,
        filename: file.name,
      });
      setSourceUrl(uploaded.secure_url);
      setSourcePublicId(uploaded.public_id);
      setCrops([]);
      setPreviewUrls([]);
      setPageIndex(0);
      toast.success("PDF uploaded — select keep-regions on each page");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed — check LIMS Settings → Cloudinary");
    } finally {
      setUploading(false);
    }
  };

  const pageCrops = crops.filter((c) => c.pageIndex === pageIndex);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el || !sourceUrl) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrag({ x0: x, y0: y, x1: x, y1: y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 0.02 || h < 0.02) return;
    setCrops((prev) => [...prev, { pageIndex, x, y, w, h }]);
  };

  const clearPageCrops = () => setCrops((prev) => prev.filter((c) => c.pageIndex !== pageIndex));

  const buildAndSave = async () => {
    if (!sourceUrl) { toast.error("Upload a lab PDF first"); return; }
    if (crops.length === 0) { toast.error("Draw at least one keep-region on the PDF"); return; }
    setComposing(true);
    try {
      const sorted = [...crops].sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y);
      const urls: string[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const region = sorted[i];
        const pngDataUrl = await renderCropToPng(sourceUrl, region, 3);
        const blob = dataUrlToBlob(pngDataUrl);
        const uploaded = await uploadBlobToCloudinary(blob, {
          resourceType: "image",
          purpose: "outsourced_pdf",
          folder: "outsourced-lab-crops",
          publicId: `${regId}_${testId}_crop_${i}_${Date.now()}`,
          filename: `${testName || "crop"}_${i + 1}.png`,
        });
        urls.push(uploaded.secure_url);
      }
      setPreviewUrls(urls);
      await onSaved({
        sourcePdfUrl: sourceUrl,
        sourcePdfPublicId: sourcePublicId,
        cropRegions: crops,
        snipImageUrls: urls,
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save cropped regions");
    } finally {
      setComposing(false);
    }
  };

  const dragStyle = drag
    ? {
        left: `${Math.min(drag.x0, drag.x1) * 100}%`,
        top: `${Math.min(drag.y0, drag.y1) * 100}%`,
        width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
        height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
      }
    : null;

  return (
    <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/40 p-3">
      <div className="text-xs font-medium text-blue-900">
        Upload lab PDF → select keep-areas (high-res crop, no letterhead) → Save to Verification.
        Demographics and letterhead are applied on provisional / final report (toggle letterhead when printing).
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPdf(f);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant="outline" asChild disabled={uploading}>
            <span>
              {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              {sourceUrl ? "Replace PDF" : "Upload lab PDF"}
            </span>
          </Button>
        </label>
        {sourceUrl && (
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => window.open(sourceUrl, "_blank")}>
            <FileText className="h-3.5 w-3.5 mr-1" /> Source PDF
          </Button>
        )}
        {previewUrls[0] && (
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => window.open(previewUrls[0], "_blank")}>
            <Image className="h-3.5 w-3.5 mr-1" /> View crop
          </Button>
        )}
      </div>

      {sourceUrl && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={pageIndex <= 0} onClick={() => setPageIndex((i) => i - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                Page {pageIndex + 1} / {Math.max(pageCount, 1)}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((i) => i + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{pageCrops.length} region(s) on this page; {crops.length} total</span>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={clearPageCrops} disabled={pageCrops.length === 0}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear page
              </Button>
            </div>
          </div>

          <div
            ref={wrapRef}
            className="relative mx-auto max-w-[520px] border bg-white select-none touch-none cursor-crosshair overflow-hidden"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {loadingPage || !pageCanvasUrl ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <img src={pageCanvasUrl} alt={`PDF page ${pageIndex + 1}`} className="w-full h-auto block pointer-events-none" draggable={false} />
            )}
            {pageCrops.map((c, i) => (
              <div
                key={`${c.pageIndex}-${i}`}
                className="absolute border-2 border-emerald-500 bg-emerald-400/20 pointer-events-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
              />
            ))}
            {dragStyle && (
              <div className="absolute border-2 border-primary bg-primary/15 pointer-events-none" style={dragStyle} />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Draw on the page to keep a region. Only selected areas are stored (high-res). Letterhead / demographics are added when the report is generated.
          </p>
        </>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void buildAndSave()}
          disabled={!sourceUrl || crops.length === 0 || composing || !!isSaving}
        >
          {(composing || isSaving) ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Save crops → Verification
        </Button>
      </div>
    </div>
  );
}