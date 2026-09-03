import RefreshButton from "@/components/lims/RefreshButton";
import PatientTestPipelineHover from "@/components/lims/PatientTestPipelineHover";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, Loader2, ChevronDown, ChevronUp, Save, ZoomIn, ZoomOut, X, Calculator, ListChecks,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentUserName } from "@/lib/auth";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { formatAgeGender } from "@/lib/ageGender";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { useLimsTabActive } from "@/lib/limsTabActive";
import {
  CBC_MORPHOLOGY_PARAM_CODES,
  CBC_MP_PARAM_CODE,
  isCbcLikeTest,
  partitionCbcCriticalParams,
} from "@/lib/cbcSmear";
import { checkDifferentialSum } from "@/lib/differentialCount";
import {
  isAbnormalResultFlag,
  isSuspectNegativeResult,
  resolveCbcDisplayFlag,
} from "@/lib/reportFlags";
import { CbcOptionalParamsToggle } from "@/components/lims/CbcOptionalParamsToggle";
import { cn } from "@/lib/utils";

const REG_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, gender, age_text, dob, visit_type, created_at, is_stat";

/** Mono / Eos / Baso — commonly blank for doctor DC entry */
const DOCTOR_FOCUS_EMPTY_CODES = new Set(["PRM0086", "PRM0048", "PRM0019"]);

type RegRow = {
  id: string;
  invoice_number: string | null;
  patient_name: string | null;
  title: string | null;
  mobile_number: string | null;
  umr_number: string | null;
  gender: string | null;
  age_text: string | null;
  dob: string | null;
  visit_type: string | null;
  created_at: string | null;
  is_stat: boolean | null;
};

type MorphEditorState = {
  rowId: string;
  paramName: string;
  options: string[];
  draft: string;
};

function asUrlList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && !!u.trim());
}

/** Same formula evaluator as Results Entry / Verification. */
function evaluateFormula(formula: any[], paramValues: Record<string, string>): string {
  if (!formula || formula.length === 0) return "";
  try {
    let expr = "";
    for (let idx = 0; idx < formula.length; idx++) {
      const token = formula[idx];
      if (token.type === "bracket_open") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        expr += "(";
      } else if (token.type === "bracket_close") {
        expr += ")";
      } else if (token.type === "parameter") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        const val = paramValues[token.parameter_id];
        if (!val || isNaN(parseFloat(val))) return "";
        expr += parseFloat(val);
      } else if (token.type === "fixed_value" || token.type === "fixed") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        expr += token.fixed_value ?? token.value ?? "";
      }
    }
    expr = expr.replace(/\s+/g, " ").trim();
    const result = new Function(`return (${expr})`)();
    if (typeof result === "number" && isFinite(result)) {
      return parseFloat(result.toFixed(2)).toString();
    }
    return "";
  } catch {
    return "";
  }
}

/** Mobile smear lightbox: pinch-zoom, pan when zoomed, swipe L/R between images. */
function SmearImageViewer({
  urls,
  open,
  onClose,
  startIndex = 0,
}: {
  urls: string[];
  open: boolean;
  onClose: () => void;
  startIndex?: number;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const idxRef = useRef(0);
  const urlsRef = useRef(urls);

  zoomRef.current = zoom;
  panRef.current = pan;
  idxRef.current = idx;
  urlsRef.current = urls;

  const goTo = useCallback((next: number) => {
    const list = urlsRef.current;
    const n = list.length;
    if (n <= 0) return;
    const clamped = ((next % n) + n) % n;
    setIdx(clamped);
    idxRef.current = clamped;
    setZoom(1);
    zoomRef.current = 1;
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    if (!open) return;
    const start = Math.min(Math.max(startIndex, 0), Math.max(urls.length - 1, 0));
    setIdx(start);
    idxRef.current = start;
    setZoom(1);
    zoomRef.current = 1;
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
  }, [open, startIndex, urls.length]);

  // Native touch listeners (non-passive) so pinch/swipe work inside Dialog.
  useEffect(() => {
    if (!open) return;
    const el = viewportRef.current;
    if (!el) return;

    type Pt = { x: number; y: number };
    const pts = (touches: TouchList): Pt[] =>
      Array.from(touches).map((t) => ({ x: t.clientX, y: t.clientY }));
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    let mode: "none" | "pinch" | "pan" | "swipe" = "none";
    let startDist = 0;
    let startZoom = 1;
    let startPan = { x: 0, y: 0 };
    let startTouch: Pt | null = null;
    let startMid: Pt | null = null;
    let moved = false;
    let lastTapAt = 0;

    const onStart = (e: TouchEvent) => {
      moved = false;
      if (e.touches.length >= 2) {
        mode = "pinch";
        const [a, b] = pts(e.touches);
        startDist = dist(a, b) || 1;
        startZoom = zoomRef.current;
        startPan = { ...panRef.current };
        startMid = mid(a, b);
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        startTouch = pts(e.touches)[0];
        startPan = { ...panRef.current };
        mode = zoomRef.current > 1.05 ? "pan" : "swipe";
      }
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const [a, b] = pts(e.touches);
        if (mode !== "pinch") {
          mode = "pinch";
          startDist = dist(a, b) || 1;
          startZoom = zoomRef.current;
          startPan = { ...panRef.current };
          startMid = mid(a, b);
        }
        const d = dist(a, b) || 1;
        const m = mid(a, b);
        const nextZoom = Math.min(5, Math.max(1, startZoom * (d / startDist)));
        e.preventDefault();
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
        if (nextZoom <= 1.01) {
          panRef.current = { x: 0, y: 0 };
          setPan({ x: 0, y: 0 });
        } else if (startMid) {
          const next = {
            x: startPan.x + (m.x - startMid.x),
            y: startPan.y + (m.y - startMid.y),
          };
          panRef.current = next;
          setPan(next);
        }
        moved = true;
        return;
      }
      if (e.touches.length === 1 && startTouch) {
        const cur = pts(e.touches)[0];
        const dx = cur.x - startTouch.x;
        const dy = cur.y - startTouch.y;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        if (mode === "pan" && zoomRef.current > 1.05) {
          e.preventDefault();
          const next = { x: startPan.x + dx, y: startPan.y + dy };
          panRef.current = next;
          setPan(next);
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (mode === "swipe" && startTouch && e.changedTouches.length >= 1) {
        const cur = {
          x: e.changedTouches[0].clientX,
          y: e.changedTouches[0].clientY,
        };
        const dx = cur.x - startTouch.x;
        const dy = cur.y - startTouch.y;
        if (
          Math.abs(dx) > 50 &&
          Math.abs(dx) > Math.abs(dy) * 1.2 &&
          zoomRef.current <= 1.05
        ) {
          if (dx < 0) goTo(idxRef.current + 1);
          else goTo(idxRef.current - 1);
          mode = "none";
          startTouch = null;
          return;
        }
        const now = Date.now();
        if (!moved && now - lastTapAt < 320) {
          if (zoomRef.current > 1.2) {
            zoomRef.current = 1;
            panRef.current = { x: 0, y: 0 };
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            zoomRef.current = 2.5;
            setZoom(2.5);
          }
          lastTapAt = 0;
        } else if (!moved) {
          lastTapAt = now;
        }
      }
      if (e.touches.length === 0) {
        mode = "none";
        startTouch = null;
        startMid = null;
        if (zoomRef.current <= 1.01) {
          zoomRef.current = 1;
          panRef.current = { x: 0, y: 0 };
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1) {
        startTouch = pts(e.touches)[0];
        startPan = { ...panRef.current };
        mode = zoomRef.current > 1.05 ? "pan" : "swipe";
        startMid = null;
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, goTo]); // idx via refs — do not rebind listeners on every image change

  if (!open || !urls.length) return null;

  const safeIdx = Math.min(Math.max(idx, 0), urls.length - 1);
  const url = urls[safeIdx];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[100vw] w-full h-[100dvh] max-h-[100dvh] rounded-none p-0 gap-0 flex flex-col sm:max-w-3xl sm:h-[90vh] sm:rounded-lg [&>button]:hidden">
        <DialogHeader className="px-3 py-2 border-b flex-row items-center justify-between space-y-0 shrink-0">
          <DialogTitle className="text-sm">
            Smear {safeIdx + 1} / {urls.length}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              disabled={urls.length < 2}
              onClick={() => goTo(safeIdx - 1)}
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              disabled={urls.length < 2}
              onClick={() => goTo(safeIdx + 1)}
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => {
                setZoom((z) => {
                  const next = Math.max(1, z - 0.25);
                  zoomRef.current = next;
                  if (next <= 1.01) {
                    panRef.current = { x: 0, y: 0 };
                    setPan({ x: 0, y: 0 });
                  }
                  return next;
                });
              }}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => {
                setZoom((z) => {
                  const next = Math.min(5, z + 0.25);
                  zoomRef.current = next;
                  return next;
                });
              }}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden bg-black select-none"
          style={{ touchAction: "none", WebkitUserSelect: "none" }}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
            }}
          >
            <img
              src={url}
              alt={`Smear ${safeIdx + 1}`}
              draggable={false}
              className="max-h-full max-w-full object-contain pointer-events-none"
            />
          </div>
          {urls.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-12 w-10 rounded-md bg-black/40 text-white flex items-center justify-center"
                onClick={() => goTo(safeIdx - 1)}
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-12 w-10 rounded-md bg-black/40 text-white flex items-center justify-center"
                onClick={() => goTo(safeIdx + 1)}
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70 pointer-events-none px-2">
            Pinch to zoom | swipe for next/prev | double-tap zoom
          </p>
        </div>

        {urls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto p-2 border-t bg-background shrink-0">
            {urls.map((u, i) => (
              <button
                key={`${u}-${i}`}
                type="button"
                className={`shrink-0 w-14 h-14 rounded border overflow-hidden ${i === safeIdx ? "ring-2 ring-primary" : ""}`}
                onClick={() => goTo(i)}
              >
                <img src={u} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Full-screen morphology / MP picker: list → select → edit → save. */
function MorphologyEditorDialog({
  state,
  onClose,
  onSave,
}: {
  state: MorphEditorState | null;
  onClose: () => void;
  onSave: (rowId: string, value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (state) {
      setDraft(state.draft || "");
      setFilter("");
    }
  }, [state]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return state.options;
    return state.options.filter((o) => o.toLowerCase().includes(q));
  }, [state, filter]);

  if (!state) return null;

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[100vw] w-full h-[100dvh] max-h-[100dvh] rounded-none p-0 gap-0 flex flex-col sm:max-w-lg sm:h-[90vh] sm:rounded-lg">
        <DialogHeader className="px-4 py-3 border-b space-y-1 shrink-0">
          <DialogTitle className="text-base pr-8">{state.paramName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tap an option, edit if needed, then Save.
          </p>
        </DialogHeader>

        <div className="px-4 py-2 border-b shrink-0">
          <Input
            className="h-10"
            placeholder="Filter options…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5" style={{ WebkitOverflowScrolling: "touch" }}>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No matching options — type freely below.</p>
          ) : (
            filtered.map((opt) => {
              const selected = draft.trim() === opt.trim();
              return (
                <button
                  key={opt}
                  type="button"
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-3 text-sm leading-snug transition-colors",
                    selected
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-background hover:bg-muted/50 active:bg-muted",
                  )}
                  onClick={() => setDraft(opt)}
                >
                  {opt}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t px-4 py-3 space-y-2 shrink-0 bg-background">
          <label className="text-xs font-medium text-muted-foreground">Selected / edit</label>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="text-sm min-h-[96px] resize-y"
            placeholder="Select above or type custom morphology text…"
          />
        </div>

        <DialogFooter className="px-4 py-3 border-t flex-row gap-2 shrink-0 sm:justify-end">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1 sm:flex-none h-11"
            onClick={() => {
              onSave(state.rowId, draft);
              onClose();
            }}
          >
            <Save className="h-4 w-4 mr-1.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DrCbcTab = () => {
  const qc = useQueryClient();
  const tabActive = useLimsTabActive();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [optionalCbcOpen, setOptionalCbcOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStart, setViewerStart] = useState(0);
  const [morphEditor, setMorphEditor] = useState<MorphEditorState | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: candidateIds = [], isLoading: loadingIds, isError: idsError, refetch: refetchIds } = useQuery({
    queryKey: ["cbc_dr_candidate_ids"],
    enabled: tabActive,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("lims_cbc_dr_candidate_ids");
      if (error) throw error;
      return (data as string[]) || [];
    },
  });

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["cbc_dr_regs", candidateIds.join(",")],
    enabled: tabActive && candidateIds.length > 0,
    queryFn: async (): Promise<RegRow[]> => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(REG_SELECT)
        .in("id", candidateIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RegRow[]) || [];
    },
  });

  const filteredRegs = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return registrations;
    return registrations.filter((r) => {
      const hay = [r.invoice_number, r.patient_name, r.umr_number, r.mobile_number]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [registrations, debouncedSearch]);

  const detailQuery = useQuery({
    queryKey: ["cbc_dr_results", expandedId],
    enabled: tabActive && !!expandedId,
    queryFn: async () => {
      const regId = expandedId!;
      const { data: reviews, error: revErr } = await supabase
        .from("cbc_smear_reviews")
        .select("*")
        .eq("registration_id", regId)
        .eq("status", "sent_to_doctor");
      if (revErr) throw revErr;
      const reviewRows = ((reviews as any[]) || []).map((r) => ({
        ...r,
        image_urls: asUrlList(r.image_urls),
      }));
      const testIds = [...new Set(reviewRows.map((r) => r.test_id))];
      if (!testIds.length) {
        return { reviews: [], cbcTests: [] as any[], results: [] as any[], paramById: {} as Record<string, any>, morphOptions: { wbc: [], rbc: [], platelet: [], mp: [] } };
      }
      const { data: tests } = await supabase.from("tests").select("id, test_name, test_code").in("id", testIds);
      const cbcTests = ((tests as any[]) || []).filter((t) => isCbcLikeTest(t.test_name, t.test_code));
      const { data: results, error: resErr } = await supabase
        .from("patient_results")
        .select("id, registration_id, test_id, parameter_id, result_value, unit, reference_range, flag, status")
        .eq("registration_id", regId)
        .in("test_id", testIds)
        .in("status", ["entered", "results_entered", "pending"]);
      if (resErr) throw resErr;
      const allResults = (results as any[]) || [];
      const paramIds = [...new Set(allResults.map((r) => r.parameter_id).filter(Boolean))];
      const paramById: Record<string, any> = {};
      if (paramIds.length) {
        const { data: params } = await supabase
          .from("report_test_parameters")
          .select("id, param_code, parameter_name, unit, normal_range_text, is_calculated, calculation_formula")
          .in("id", paramIds);
        const orderByParam: Record<string, number> = {};
        const { data: tpRows } = await supabase
          .from("test_parameters")
          .select("parameter_id, display_order")
          .in("test_id", testIds)
          .in("parameter_id", paramIds);
        for (const row of (tpRows as any[]) || []) {
          const pid = String(row.parameter_id || "");
          const ord = Number(row.display_order ?? 9999);
          if (pid && (orderByParam[pid] == null || ord < orderByParam[pid])) orderByParam[pid] = ord;
        }
        for (const p of (params as any[]) || []) {
          const formula = Array.isArray(p.calculation_formula) ? p.calculation_formula : [];
          paramById[p.id] = {
            parameterId: p.id,
            paramCode: String(p.param_code || ""),
            parameterName: String(p.parameter_name || ""),
            unit: String(p.unit || ""),
            normalRangeText: String(p.normal_range_text || ""),
            displayOrder: orderByParam[p.id] ?? 9999,
            isCalculated: !!p.is_calculated,
            calculationFormula: formula,
          };
        }
      }
      const morphCodes = [...CBC_MORPHOLOGY_PARAM_CODES, CBC_MP_PARAM_CODE];
      const morphParamIds = Object.values(paramById)
        .filter((p: any) => morphCodes.includes(p.paramCode))
        .map((p: any) => p.parameterId);
      const morphOptions = { wbc: [] as string[], rbc: [] as string[], platelet: [] as string[], mp: [] as string[] };
      if (morphParamIds.length) {
        const { data: ranges } = await supabase
          .from("parameter_normal_ranges")
          .select("parameter_id, descriptive_options")
          .in("parameter_id", morphParamIds);
        const byParam: Record<string, string[]> = {};
        for (const row of (ranges as any[]) || []) {
          const opts = Array.isArray(row.descriptive_options)
            ? row.descriptive_options.filter((o: unknown) => typeof o === "string" && String(o).trim())
            : [];
          if (!opts.length) continue;
          byParam[row.parameter_id] = [...new Set([...(byParam[row.parameter_id] || []), ...opts])];
        }
        const codeToOpts = (code: string) => {
          const meta = Object.values(paramById).find((p: any) => p.paramCode === code) as any;
          return meta ? byParam[meta.parameterId] || [] : [];
        };
        morphOptions.wbc = codeToOpts("PRM0157");
        morphOptions.rbc = codeToOpts("PRM0115");
        morphOptions.platelet = codeToOpts("PRM0102");
        morphOptions.mp = codeToOpts(CBC_MP_PARAM_CODE);
      }
      return { reviews: reviewRows, cbcTests, results: allResults, paramById, morphOptions };
    },
  });

  const reviews = detailQuery.data?.reviews || [];
  const cbcTests = detailQuery.data?.cbcTests || [];
  const results = detailQuery.data?.results || [];
  const paramById = detailQuery.data?.paramById || {};
  const morphOptions = detailQuery.data?.morphOptions || { wbc: [], rbc: [], platelet: [], mp: [] };

  useEffect(() => {
    if (!expandedId || cbcTests.length === 0) {
      setSelectedTestId(null);
      setEdited({});
      return;
    }
    setSelectedTestId((prev) => (prev && cbcTests.some((t: any) => t.id === prev) ? prev : cbcTests[0].id));
    setEdited({});
    setOptionalCbcOpen(false);
  }, [expandedId, cbcTests]);

  const activeReview = useMemo(
    () => reviews.find((r: any) => r.test_id === selectedTestId) || null,
    [reviews, selectedTestId],
  );
  const imageUrls = activeReview?.image_urls || [];

  const testResults = useMemo(() => {
    const rows = results.filter((r: any) => r.test_id === selectedTestId);
    return [...rows].sort((a: any, b: any) => {
      const oa = paramById[a.parameter_id]?.displayOrder ?? 9999;
      const ob = paramById[b.parameter_id]?.displayOrder ?? 9999;
      if (oa !== ob) return oa - ob;
      return String(paramById[a.parameter_id]?.parameterName || "").localeCompare(
        String(paramById[b.parameter_id]?.parameterName || ""),
      );
    });
  }, [results, selectedTestId, paramById]);

  const expandedReg = useMemo(
    () => (expandedId ? registrations.find((r) => r.id === expandedId) || null : null),
    [expandedId, registrations],
  );

  const { data: historicalResults = [] } = useQuery({
    queryKey: ["cbc_dr_historical", expandedReg?.umr_number, expandedId],
    enabled: tabActive && !!expandedReg?.umr_number && !!expandedId,
    queryFn: async () => {
      const { data: sameUmrRegs } = await supabase
        .from("patient_registrations")
        .select("id")
        .eq("umr_number", expandedReg!.umr_number!)
        .neq("id", expandedId!);
      const regIds = (sameUmrRegs || []).map((r: any) => r.id);
      if (!regIds.length) return [];
      const { data, error } = await supabase
        .from("patient_results")
        .select("parameter_id, result_value, created_at")
        .in("registration_id", regIds)
        .not("result_value", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const historyMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of historicalResults as any[]) {
      if (!r.parameter_id) continue;
      if (!map[r.parameter_id]) map[r.parameter_id] = [];
      if (map[r.parameter_id].length < 2) map[r.parameter_id].push(r.result_value || "");
    }
    return map;
  }, [historicalResults]);

  const isMorph = useCallback((code: string) => {
    return (
      CBC_MORPHOLOGY_PARAM_CODES.includes(code as any) ||
      code === CBC_MP_PARAM_CODE
    );
  }, []);

  const morphOptsFor = useCallback(
    (code: string) => {
      if (code === "PRM0157") return morphOptions.wbc;
      if (code === "PRM0115") return morphOptions.rbc;
      if (code === "PRM0102") return morphOptions.platelet;
      if (code === CBC_MP_PARAM_CODE) {
        return morphOptions.mp.length ? morphOptions.mp : ["Not detected", "Detected"];
      }
      return [];
    },
    [morphOptions],
  );

  const getVal = useCallback(
    (row: any, overlay?: Record<string, string>) => {
      const src = overlay || edited;
      if (src[row.id] !== undefined) return src[row.id];
      return row.result_value || "";
    },
    [edited],
  );

  /** Apply value change and recalculate dependent calculated parameters. */
  const setResultValue = useCallback(
    (rowId: string, value: string) => {
      setEdited((prev) => {
        const next: Record<string, string> = { ...prev, [rowId]: value };
        const byParamId: Record<string, string> = {};
        for (const r of testResults) {
          byParamId[r.parameter_id] =
            r.id === rowId ? value : next[r.id] !== undefined ? next[r.id] : r.result_value || "";
        }
        for (const r of testResults) {
          const meta = paramById[r.parameter_id];
          if (!meta?.isCalculated || !meta.calculationFormula?.length) continue;
          const calc = evaluateFormula(meta.calculationFormula, byParamId);
          next[r.id] = calc;
          byParamId[r.parameter_id] = calc;
        }
        return next;
      });
    },
    [testResults, paramById],
  );

  const recalculateAll = useCallback(() => {
    setEdited((prev) => {
      const next = { ...prev };
      const byParamId: Record<string, string> = {};
      for (const r of testResults) {
        byParamId[r.parameter_id] = next[r.id] !== undefined ? next[r.id] : r.result_value || "";
      }
      let changed = false;
      for (const r of testResults) {
        const meta = paramById[r.parameter_id];
        if (!meta?.isCalculated || !meta.calculationFormula?.length) continue;
        const calc = evaluateFormula(meta.calculationFormula, byParamId);
        const current = byParamId[r.parameter_id] || "";
        if (calc !== current) {
          next[r.id] = calc;
          byParamId[r.parameter_id] = calc;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [testResults, paramById]);

  // Auto-run calculated params when opening a test (same behaviour as Results / Verification).
  useEffect(() => {
    if (!selectedTestId || testResults.length === 0) return;
    const hasCalc = testResults.some((r: any) => paramById[r.parameter_id]?.isCalculated);
    if (!hasCalc) return;
    recalculateAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on test / result set change
  }, [selectedTestId, testResults.length, detailQuery.dataUpdatedAt]);

  const diffCheck = useMemo(() => {
    const list = testResults.map((r: any) => ({
      paramCode: paramById[r.parameter_id]?.paramCode || "",
      value: getVal(r),
    }));
    return checkDifferentialSum(list);
  }, [testResults, paramById, getVal, edited]);

  const handleSave = async () => {
    if (!expandedId || !selectedTestId || !activeReview) return;
    if (!diffCheck.isOk && diffCheck.hasDifferential) {
      toast.error(`Differential sum is ${diffCheck.sum}% (must be 100%)`);
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const who = getCurrentUserName() || "doctor";
      for (const row of testResults) {
        const val = getVal(row);
        const meta = paramById[row.parameter_id];
        const flag = resolveCbcDisplayFlag({
          value: val,
          savedValue: row.result_value,
          savedFlag: row.flag,
          normalRangeText: row.reference_range || meta?.normalRangeText,
          unit: row.unit || meta?.unit,
        });
        const valueChanged = String(val) !== String(row.result_value || "");
        const flagChanged = String(flag || "") !== String(row.flag || "");
        if (!valueChanged && !flagChanged) continue;
        const { error } = await supabase
          .from("patient_results")
          .update({
            result_value: val || null,
            flag: flag || null,
            status: "verified",
            verified_at: now,
            verified_by: who,
            updated_at: now,
          } as any)
          .eq("id", row.id);
        if (error) throw error;
      }
      await supabase
        .from("patient_results")
        .update({
          status: "verified",
          verified_at: now,
          verified_by: who,
          updated_at: now,
        } as any)
        .eq("registration_id", expandedId)
        .eq("test_id", selectedTestId)
        .in("status", ["entered", "results_entered", "pending"]);

      const { error: revErr } = await supabase
        .from("cbc_smear_reviews")
        .update({
          status: "doctor_saved",
          doctor_saved_at: now,
          doctor_saved_by: who,
          updated_at: now,
        } as any)
        .eq("id", activeReview.id);
      if (revErr) throw revErr;

      await propagateRegistrationChange(qc, expandedId, ["dr_cbc", "doctor_approval", "verification", "cbc"]);
      toast.success("Saved — moved to Doctor Approval");
      setExpandedId(null);
      await qc.invalidateQueries({ queryKey: ["cbc_dr_candidate_ids"] });
      await qc.invalidateQueries({ queryKey: ["cbc_dr_regs"] });
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setOptionalCbcOpen(false);
  }, [selectedTestId]);

  const openMorphEditor = (row: any) => {
    const meta = paramById[row.parameter_id];
    const code = meta?.paramCode || "";
    setMorphEditor({
      rowId: row.id,
      paramName: meta?.parameterName || code || "Morphology",
      options: morphOptsFor(code),
      draft: getVal(row),
    });
  };

  const renderDrCbcResultRow = (r: any) => {
    const meta = paramById[r.parameter_id];
    const code = meta?.paramCode || "";
    const hist = historyMap[r.parameter_id] || [];
    const morph = isMorph(code);
    const value = getVal(r);
    const empty = !String(value || "").trim();
    const needsDoctorFocus =
      empty && (DOCTOR_FOCUS_EMPTY_CODES.has(code) || morph);
    const flag = resolveCbcDisplayFlag({
      value,
      savedValue: r.result_value,
      savedFlag: r.flag,
      normalRangeText: r.reference_range || meta?.normalRangeText,
      unit: r.unit || meta?.unit,
    });
    const isNegative = isSuspectNegativeResult(value);
    const isAbnormal = isAbnormalResultFlag(flag);
    const isCalc = !!meta?.isCalculated;

    const rowBg = isNegative
      ? "bg-red-50"
      : isAbnormal
        ? "bg-destructive/5"
        : needsDoctorFocus
          ? "bg-amber-50"
          : "";
    const stickyBg = isNegative
      ? "bg-red-50"
      : isAbnormal
        ? "bg-destructive/5"
        : needsDoctorFocus
          ? "bg-amber-50"
          : "bg-background";
    const inputAbnCls = isNegative
      ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold"
      : isAbnormal
        ? "border-destructive text-destructive font-bold"
        : needsDoctorFocus
          ? "border-amber-300 bg-amber-50/80"
          : "";

    return (
      <TableRow key={r.id} className={cn(rowBg, needsDoctorFocus && "shadow-[inset_3px_0_0_0_#f59e0b]")}>
        <TableCell
          className={cn(
            "text-xs font-medium sticky left-0 z-[1] min-w-[7.5rem] max-w-[9rem] sm:max-w-[14rem] sm:min-w-[10rem]",
            stickyBg,
          )}
        >
          <span className="inline-flex items-center gap-1 flex-wrap">
            {meta?.parameterName || "—"}
            {isCalc && <Calculator className="inline h-3.5 w-3.5 text-primary shrink-0" aria-label="Calculated" />}
          </span>
        </TableCell>
        <TableCell className="text-xs min-w-[9rem] sm:min-w-[11rem]">
          {morph ? (
            <button
              type="button"
              className={cn(
                "w-full min-h-10 text-left rounded-md border px-2.5 py-2 text-sm leading-snug",
                empty ? "text-muted-foreground border-amber-300 bg-amber-50/80" : "border-input bg-background",
                inputAbnCls,
              )}
              onClick={() => openMorphEditor(r)}
            >
              <span className="inline-flex items-start gap-1.5 w-full">
                <ListChecks className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span className="whitespace-pre-wrap break-words flex-1">
                  {value || "Tap to select / edit…"}
                </span>
              </span>
            </button>
          ) : isCalc ? (
            <div className="flex items-center gap-1">
              <Input
                className={cn("h-10 text-sm font-mono flex-1 min-w-0", inputAbnCls)}
                value={value}
                placeholder="Auto"
                onChange={(e) => setResultValue(r.id, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                title="Recalculate"
                onClick={() => {
                  const byParamId: Record<string, string> = {};
                  for (const row of testResults) {
                    byParamId[row.parameter_id] = getVal(row);
                  }
                  const calc = evaluateFormula(meta.calculationFormula || [], byParamId);
                  if (calc) setResultValue(r.id, calc);
                }}
              >
                <Calculator className="h-4 w-4 text-primary" />
              </Button>
            </div>
          ) : (
            <Input
              className={cn("h-10 text-sm", inputAbnCls)}
              value={value}
              onChange={(e) => setResultValue(r.id, e.target.value)}
            />
          )}
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap">{r.unit || meta?.unit || "—"}</TableCell>
        <TableCell className="text-xs whitespace-pre-line max-w-[7rem] sm:max-w-[10rem]">
          {r.reference_range || meta?.normalRangeText || "—"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{hist[0] || "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{hist[1] || "—"}</TableCell>
        <TableCell className="font-mono text-[11px] hidden sm:table-cell">{code || "—"}</TableCell>
        <TableCell className="text-xs text-center hidden sm:table-cell">
          {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
          {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
          {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
          {flag === "X" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
          {flag === "A" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
          {!flag && value && <Badge variant="outline" className="text-xs">—</Badge>}
          {!flag && !value && "—"}
        </TableCell>
        <TableCell className="text-xs hidden sm:table-cell">
          <Badge variant="outline" className="text-[10px]">Dr. CBC</Badge>
        </TableCell>
      </TableRow>
    );
  };

  const isLoading = loadingIds || loadingRegs;
  const COL_COUNT = 9;

  return (
    <div className="space-y-3 pb-24 sm:pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 h-10"
            placeholder="Search invoice / name / mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <RefreshButton queryKeys={["cbc_dr_candidate_ids", "cbc_dr_regs", "cbc_dr_results", "cbc_dr_historical"]} />
        <Badge variant="secondary">{filteredRegs.length}</Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Review smear images, edit CBC results, then Save to send to Doctor Approval.
        Empty Mono / Eos / Baso and morphology rows are highlighted in yellow.
      </p>

      {idsError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm space-y-3">
            <p className="text-muted-foreground">Could not load Dr. CBC queue.</p>
            <Button size="sm" variant="outline" onClick={() => void refetchIds()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filteredRegs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No CBC cases waiting for doctor review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredRegs.map((reg) => {
            const open = expandedId === reg.id;
            return (
              <Card key={reg.id} className={open ? "ring-1 ring-primary/30" : ""}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-3 flex items-center gap-2 hover:bg-muted/40"
                  onClick={() => setExpandedId(open ? null : reg.id)}
                >
                  {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <PatientTestPipelineHover registrationId={reg.id} invoiceNumber={reg.invoice_number || ""} />
                      </span>
                      <Badge className="text-[10px] bg-violet-100 text-violet-800 border-violet-200" variant="outline">
                        Dr. CBC
                      </Badge>
                      {reg.is_stat && <Badge variant="destructive" className="text-[10px]">STAT</Badge>}
                      <span className="text-sm text-muted-foreground truncate">{patientDisplayName(reg)}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {formatAgeGender(reg.dob, reg.gender, reg.age_text)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{reg.mobile_number || "—"}</div>
                  </div>
                </button>

                {open && (
                  <CardContent className="border-t pt-3 space-y-4 px-3 sm:px-6">
                    {detailQuery.isLoading ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : (
                      <>
                        {cbcTests.length > 1 && (
                          <div className="flex flex-wrap gap-2">
                            {cbcTests.map((t: any) => (
                              <Button
                                key={t.id}
                                type="button"
                                size="sm"
                                variant={selectedTestId === t.id ? "default" : "outline"}
                                onClick={() => setSelectedTestId(t.id)}
                              >
                                {t.test_name}
                              </Button>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Microscope images ({imageUrls.length})</h4>
                          {imageUrls.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No images attached.</p>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                              {imageUrls.map((url: string, i: number) => (
                                <button
                                  key={`${url}-${i}`}
                                  type="button"
                                  className="aspect-square rounded-md border overflow-hidden bg-muted"
                                  onClick={() => { setViewerStart(i); setViewerOpen(true); }}
                                >
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                          {imageUrls.length > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full sm:w-auto h-10"
                              onClick={() => { setViewerStart(0); setViewerOpen(true); }}
                            >
                              <ZoomIn className="h-4 w-4 mr-1" />
                              Open images (pinch / swipe)
                            </Button>
                          )}
                        </div>

                        <div className="rounded-md border overflow-x-auto -mx-1 sm:mx-0">
                          <Table className="min-w-[520px] sm:min-w-0">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs sticky left-0 z-[2] bg-muted/80 min-w-[7.5rem]">
                                  Parameter
                                </TableHead>
                                <TableHead className="text-xs min-w-[9rem]">Result</TableHead>
                                <TableHead className="text-xs">Unit</TableHead>
                                <TableHead className="text-xs">Ref</TableHead>
                                <TableHead className="text-xs">Prev 1</TableHead>
                                <TableHead className="text-xs">Prev 2</TableHead>
                                <TableHead className="text-xs hidden sm:table-cell">Code</TableHead>
                                <TableHead className="text-xs hidden sm:table-cell">Flag</TableHead>
                                <TableHead className="text-xs hidden sm:table-cell">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                const rowsWithCode = testResults.map((r: any) => ({
                                  ...r,
                                  paramCode: paramById[r.parameter_id]?.paramCode || "",
                                }));
                                const { mainParams, optionalVisible, optionalHidden } =
                                  partitionCbcCriticalParams(rowsWithCode, (row) => getVal(row));
                                return (
                                  <>
                                    {[...mainParams, ...optionalVisible].map((row) =>
                                      renderDrCbcResultRow(row),
                                    )}
                                    <CbcOptionalParamsToggle
                                      hiddenCount={optionalHidden.length}
                                      open={optionalCbcOpen}
                                      colSpan={COL_COUNT}
                                      onOpenChange={setOptionalCbcOpen}
                                    />
                                    {optionalCbcOpen &&
                                      optionalHidden.map((row) => renderDrCbcResultRow(row))}
                                  </>
                                );
                              })()}
                              {testResults.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={COL_COUNT} className="text-muted-foreground text-sm">
                                    No CBC result rows
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t pt-3 -mx-3 px-3 pb-3 sm:static sm:border-0 sm:p-0 sm:mx-0 space-y-2">
                          {diffCheck.hasDifferential && (
                            <div className="text-sm">
                              Differential (DC) sum:{" "}
                              <span
                                className={
                                  diffCheck.isOk
                                    ? "text-green-700 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {diffCheck.sum}%
                              </span>
                              {!diffCheck.isOk && (
                                <span className="text-red-600">
                                  {" "}
                                  (must equal 100% — diff {diffCheck.diff > 0 ? "+" : ""}
                                  {diffCheck.diff})
                                </span>
                              )}
                            </div>
                          )}
                          <Button
                            type="button"
                            className="w-full sm:w-auto h-11 text-base"
                            disabled={
                              busy ||
                              !activeReview ||
                              (!diffCheck.isOk && diffCheck.hasDifferential)
                            }
                            onClick={() => void handleSave()}
                          >
                            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                            Save
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <SmearImageViewer
        urls={imageUrls}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        startIndex={viewerStart}
      />

      <MorphologyEditorDialog
        state={morphEditor}
        onClose={() => setMorphEditor(null)}
        onSave={(rowId, value) => setResultValue(rowId, value)}
      />
    </div>
  );
};

export default DrCbcTab;
