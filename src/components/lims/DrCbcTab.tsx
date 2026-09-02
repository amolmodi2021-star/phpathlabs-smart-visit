import RefreshButton from "@/components/lims/RefreshButton";
import { DescriptiveCombobox } from "@/components/lims/DescriptiveCombobox";
import PatientTestPipelineHover from "@/components/lims/PatientTestPipelineHover";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Loader2, ChevronDown, ChevronUp, Save, ZoomIn, ZoomOut, X,
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
import {
  isAbnormalResultFlag,
  isSuspectNegativeResult,
  resolveCbcDisplayFlag,
} from "@/lib/reportFlags";
import { CbcOptionalParamsToggle } from "@/components/lims/CbcOptionalParamsToggle";

const REG_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, gender, age_text, dob, visit_type, created_at, is_stat";

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

function asUrlList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && !!u.trim());
}

/** Mobile-friendly smear lightbox with pinch-friendly zoom controls. */
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
  useEffect(() => {
    if (open) {
      setIdx(startIndex);
      setZoom(1);
    }
  }, [open, startIndex]);
  if (!urls.length) return null;
  const url = urls[Math.min(Math.max(idx, 0), urls.length - 1)];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[100vw] w-full h-[100dvh] max-h-[100dvh] rounded-none p-0 gap-0 flex flex-col sm:max-w-3xl sm:h-[90vh] sm:rounded-lg">
        <DialogHeader className="px-3 py-2 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm">
            Smear {idx + 1} / {urls.length}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={() => setZoom((z) => Math.max(1, z - 0.25))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div
          className="flex-1 overflow-auto bg-black touch-pan-x touch-pan-y"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="min-h-full min-w-full flex items-center justify-center p-2">
            <img
              src={url}
              alt={`Smear ${idx + 1}`}
              draggable={false}
              className="max-w-none select-none"
              style={{
                width: `${zoom * 100}%`,
                touchAction: "pan-x pan-y pinch-zoom",
              }}
            />
          </div>
        </div>
        {urls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto p-2 border-t bg-background">
            {urls.map((u, i) => (
              <button
                key={`${u}-${i}`}
                type="button"
                className={`shrink-0 w-14 h-14 rounded border overflow-hidden ${i === idx ? "ring-2 ring-primary" : ""}`}
                onClick={() => { setIdx(i); setZoom(1); }}
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
          .select("id, param_code, parameter_name, unit, normal_range_text")
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
          paramById[p.id] = {
            parameterId: p.id,
            paramCode: String(p.param_code || ""),
            parameterName: String(p.parameter_name || ""),
            unit: String(p.unit || ""),
            normalRangeText: String(p.normal_range_text || ""),
            displayOrder: orderByParam[p.id] ?? 9999,
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
      if (code === CBC_MP_PARAM_CODE) return morphOptions.mp.length ? morphOptions.mp : ["Not detected", "Detected"];
      return [];
    },
    [morphOptions],
  );

  const getVal = (row: any) => {
    const key = row.id;
    return edited[key] !== undefined ? edited[key] : row.result_value || "";
  };

  const handleSave = async () => {
    if (!expandedId || !selectedTestId || !activeReview) return;
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
      // Promote remaining CBC rows for this test to verified so Doctor Approval picks them up
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

  const renderDrCbcResultRow = (r: any) => {
    const meta = paramById[r.parameter_id];
    const code = meta?.paramCode || "";
    const hist = historyMap[r.parameter_id] || [];
    const morph = isMorph(code);
    const opts = morphOptsFor(code);
    const value = getVal(r);
    const flag = resolveCbcDisplayFlag({
      value,
      savedValue: r.result_value,
      savedFlag: r.flag,
      normalRangeText: r.reference_range || meta?.normalRangeText,
      unit: r.unit || meta?.unit,
    });
    const isNegative = isSuspectNegativeResult(value);
    const isAbnormal = isAbnormalResultFlag(flag);
    const rowBg = isNegative
      ? "bg-red-50"
      : isAbnormal
        ? "bg-destructive/5"
        : "";
    const inputAbnCls = isNegative
      ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold"
      : isAbnormal
        ? "border-destructive text-destructive font-bold"
        : "";
    return (
      <TableRow key={r.id} className={rowBg}>
        <TableCell className="font-mono text-[11px]">{code || "—"}</TableCell>
        <TableCell className="text-xs">{meta?.parameterName || "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{hist[0] || "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{hist[1] || "—"}</TableCell>
        <TableCell className="text-xs">
          {morph && opts.length > 0 ? (
            <DescriptiveCombobox
              value={value}
              options={opts}
              onChange={(v) => setEdited((prev) => ({ ...prev, [r.id]: v }))}
            />
          ) : (
            <Input
              className={`h-8 text-xs ${inputAbnCls}`}
              value={value}
              onChange={(e) =>
                setEdited((prev) => ({ ...prev, [r.id]: e.target.value }))
              }
            />
          )}
        </TableCell>
        <TableCell className="text-xs">{r.unit || meta?.unit || "—"}</TableCell>
        <TableCell className="text-xs whitespace-pre-line max-w-[120px]">
          {r.reference_range || meta?.normalRangeText || "—"}
        </TableCell>
        <TableCell className="text-xs text-center">
          {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
          {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
          {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
          {flag === "X" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
          {flag === "A" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
          {!flag && value && <Badge variant="outline" className="text-xs">—</Badge>}
          {!flag && !value && "—"}
        </TableCell>
        <TableCell className="text-xs">
          <Badge variant="outline" className="text-[10px]">Dr. CBC</Badge>
        </TableCell>
      </TableRow>
    );
  };

  const isLoading = loadingIds || loadingRegs;

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
                  <CardContent className="border-t pt-3 space-y-4">
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

                        {/* Images first on mobile — primary doctor task */}
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
                              Open images (pinch to zoom)
                            </Button>
                          )}
                        </div>

                        <div className="rounded-md border overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Code</TableHead>
                                <TableHead className="text-xs">Parameter</TableHead>
                                <TableHead className="text-xs">Prev 1</TableHead>
                                <TableHead className="text-xs">Prev 2</TableHead>
                                <TableHead className="text-xs min-w-[140px]">Result</TableHead>
                                <TableHead className="text-xs">Unit</TableHead>
                                <TableHead className="text-xs">Ref</TableHead>
                                <TableHead className="text-xs">Flag</TableHead>
                                <TableHead className="text-xs">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                const rowsWithCode = testResults.map((r: any) => ({
                                  ...r,
                                  paramCode: paramById[r.parameter_id]?.paramCode || "",
                                }));
                                const { mainParams, optionalVisible, optionalHidden } =
                                  partitionCbcCriticalParams(rowsWithCode, (r) => getVal(r));
                                return (
                                  <>
                                    {[...mainParams, ...optionalVisible].map((r) =>
                                      renderDrCbcResultRow(r),
                                    )}
                                    <CbcOptionalParamsToggle
                                      hiddenCount={optionalHidden.length}
                                      open={optionalCbcOpen}
                                      colSpan={9}
                                      onOpenChange={setOptionalCbcOpen}
                                    />
                                    {optionalCbcOpen &&
                                      optionalHidden.map((r) => renderDrCbcResultRow(r))}
                                  </>
                                );
                              })()}
                              {testResults.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={9} className="text-muted-foreground text-sm">
                                    No CBC result rows
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t pt-3 -mx-6 px-6 pb-3 sm:static sm:border-0 sm:p-0 sm:mx-0">
                          <Button
                            type="button"
                            className="w-full sm:w-auto h-11 text-base"
                            disabled={busy || !activeReview}
                            onClick={() => void handleSave()}
                          >
                            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                            Save &amp; send to Doctor Approval
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
    </div>
  );
};

export default DrCbcTab;
