import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// Parent ResultsEntry owns pipeline realtime (includes outsourced keys).
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Search, ChevronDown, ChevronUp, Save, Loader2, Image, Keyboard,
  Clipboard, Trash2, ExternalLink, Package, Send, Clock, CheckCircle2, Pencil, Plus, FileText, ArrowLeftRight
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import SnipOnLetterhead from "./SnipOnLetterhead";
import { useMasterLookup } from "@/hooks/useMasterLookup";

import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import { findPatientResultRow } from "@/lib/patientResultLookup";
import { formatAgeGender } from "@/lib/ageGender";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { getCurrentUserName } from "@/lib/auth";
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { PATIENT_RESULTS_SELECT_RESULTS } from "@/lib/patientResultsSelect";
import { fetchOutsourcedCandidateIds, fetchFilteredSortedIds } from "@/lib/limsPendingCandidates";
import { shortIdsKey } from "@/lib/queryKeys";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isSnipResultRow, snipImageUrlsFromRow } from "@/lib/outsourcedResultMode";
import {
  loadOutsourcedRefRange,
  loadOutsourcedUnit,
  resolveOutsourcedFlag,
  resolveOutsourcedRefRange,
  resolveOutsourcedUnit,
} from "@/lib/outsourcedResultOverrides";
import { calculateResultFlag } from "@/lib/reportFlags";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";

interface OutsourcedTest {
  testId: string;
  testName: string;
  outsourcedCaption: string;
  isTransferredInhouse: boolean; // true = originally inhouse, transferred to outsourced
  outsourcedParameterIds?: string[]; // if set, only these params are outsourced (parameter-level)
  isParameterLevel: boolean; // true = only specific params outsourced, not whole test
}

interface OutsourcedPatient {
  registration: any;
  outsourcedTests: OutsourcedTest[];
}

const OS_PAGE_SIZE = 50;

const OutsourcedResults = ({ externalSearch }: { externalSearch?: string }) => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [osPage, setOsPage] = useState(0);
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [editedUnits, setEditedUnits] = useState<Record<string, string>>({});
  const [editedRefRanges, setEditedRefRanges] = useState<Record<string, string>>({});
  const [editedFlags, setEditedFlags] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const { data: outsourceLabs = [] } = useMasterLookup("outsource_lab");

  // Selection & mark-as-sent state
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [showLabDialog, setShowLabDialog] = useState(false);
  const [labName, setLabName] = useState("");
  const [markingSent, setMarkingSent] = useState(false);

  // Edit lab name state
  const [editLabKey, setEditLabKey] = useState<string | null>(null);
  const [editLabName, setEditLabName] = useState("");
  const [savingEditLab, setSavingEditLab] = useState(false);

  // Return to inhouse state
  const [returningKey, setReturningKey] = useState<string | null>(null);

  // Exclusive mode switch: confirm before wiping the other entry method
  const [modeSwitchConfirm, setModeSwitchConfirm] = useState<{
    regId: string;
    testId: string;
    testName: string;
    to: "manual" | "snip";
    outsourcedParamIds?: string[];
  } | null>(null);
  const [modeOverride, setModeOverride] = useState<Record<string, "manual" | "snip">>({});

  // Return entire test to inhouse
  const returnToInhouse = async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setReturningKey(key);
    try {
      await supabase.from("outsourced_test_snips").delete().eq("registration_id", regId).eq("test_id", testId);
      toast.success(`${testName} returned to Inhouse`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_accepted_regs"] });
      qc.invalidateQueries({ queryKey: ["outsourced_pending_ids"] });
      qc.invalidateQueries({ queryKey: ["results_accepted_regs"] });
    } catch (err: any) {
      toast.error(err.message || "Return failed");
    } finally {
      setReturningKey(null);
    }
  };

  // Return individual parameter to inhouse
  const returnParamToInhouse = async (regId: string, testId: string, paramId: string, paramName: string) => {
    const key = `${regId}||${paramId}`;
    setReturningKey(key);
    try {
      const snip = existingSnips.find((s: any) => s.registration_id === regId && s.test_id === testId);
      const currentIds: string[] = Array.isArray(snip?.outsourced_parameter_ids) ? snip.outsourced_parameter_ids : [];
      const newIds = currentIds.filter(id => id !== paramId);
      if (newIds.length === 0) {
        // No more outsourced params, delete the snip record
        await supabase.from("outsourced_test_snips").delete().eq("registration_id", regId).eq("test_id", testId);
      } else {
        await supabase.from("outsourced_test_snips").update({
          outsourced_parameter_ids: newIds,
        } as any).eq("registration_id", regId).eq("test_id", testId);
      }
      toast.success(`${paramName} returned to Inhouse`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["outsourced_pending_ids"] });
    } catch (err: any) {
      toast.error(err.message || "Return failed");
    } finally {
      setReturningKey(null);
    }
  };

  // Sync external search to debounced
  useEffect(() => {
    if (externalSearch !== undefined) {
      setDebouncedSearch(externalSearch);
      setOsPage(0);
    }
  }, [externalSearch]);

  // Debounce search (internal fallback)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { setDebouncedSearch(val); setOsPage(0); }, 400);
  }, []);

  // Candidate IDs (server-side) + search filter/sort
  const { data: pendingIds = [] as string[], isLoading: loadingIds } = useQuery({
    queryKey: ["outsourced_pending_ids", debouncedSearch],
    queryFn: async (): Promise<string[]> => {
      const candidates = await fetchOutsourcedCandidateIds();
      return await fetchFilteredSortedIds(candidates, debouncedSearch);
    },
    staleTime: 120_000,
  });
  const osCount = pendingIds.length;
  const pageIds = pendingIds.slice(osPage * OS_PAGE_SIZE, (osPage + 1) * OS_PAGE_SIZE);
  const osTotalPages = Math.max(1, Math.ceil(osCount / OS_PAGE_SIZE));
  const pageKey = shortIdsKey(pageIds, "os");

  // Fetch page of registrations (narrow columns)
  const { data: acceptedRegs = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["outsourced_accepted_regs", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, age_text, created_at, updated_at, bill_cancelled, doctor_name, title")
        .in("id", pageIds);
      if (error) throw error;
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      return ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    staleTime: 120_000,
  });
  const isLoading = loadingIds || (pageIds.length > 0 && loadingRegs);

  // Fetch tests master (shared-ish)
  const { data: testsMap = {} } = useQuery({
    queryKey: ["outsourced_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, is_outsourced, outsourced_caption");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
    staleTime: 600_000,
  });

  const regIds = useMemo(() => acceptedRegs.map((r: any) => r.id), [acceptedRegs]);

  // Snips for this page only
  const { data: existingSnips = [] } = useQuery({
    queryKey: ["outsourced_snips", pageKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "outsourced_test_snips",
        "*",
        "registration_id",
        regIds,
      );
    },
    staleTime: 120_000,
  });

  // sample_tubes leaves for this page
  const { data: leafTestIdsByReg = {} } = useQuery({
    queryKey: ["outsourced_sample_tubes_leaves", pageKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const rows = await fetchAllByIds<any>(
        "sample_tubes",
        "id, registration_id, test_ids",
        "registration_id",
        regIds,
      );
      const map: Record<string, Set<string>> = {};
      rows.forEach((tube: any) => {
        const rid = tube.registration_id;
        if (!rid) return;
        if (!map[rid]) map[rid] = new Set<string>();
        const ids: string[] = Array.isArray(tube.test_ids) ? tube.test_ids : [];
        ids.forEach((id) => map[rid].add(id));
      });
      return map;
    },
  });

  // Manual results for this page
  const { data: existingResults = [] } = useQuery({
    queryKey: ["outsourced_manual_results", pageKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "patient_results",
        PATIENT_RESULTS_SELECT_RESULTS,
        "registration_id",
        regIds,
      );
    },
  });

  // Fetch test_parameters
  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["outsourced_test_params"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text)")
        .order("display_order");
      const map: Record<string, any[]> = {};
      (data || []).forEach((tp: any) => {
        if (!tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = [];
        map[tp.test_id].push(tp);
      });
      return map;
    },
    staleTime: 600_000,
  });

  // Fetch parameter_normal_ranges for age/gender-specific reference ranges
  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["outsourced_normal_ranges"],
    queryFn: async () => {
      const { data } = await supabase
        .from("parameter_normal_ranges")
        .select("*")
        .order("age_min");
      const map: Record<string, any[]> = {};
      (data || []).forEach((r: any) => {
        if (!map[r.parameter_id]) map[r.parameter_id] = [];
        map[r.parameter_id].push(r);
      });
      return map;
    },
    staleTime: 600_000,
  });

  // Helper: resolve best normal range for a parameter given patient demographics
  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) {
      return {
        text: "", low: null as number | null, high: null as number | null,
        rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "",
      };
    }
    let patientAge: number | null = null;
    if (reg.dob) {
      const birth = new Date(reg.dob);
      const now = new Date();
      patientAge = Math.floor((now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    const patientGender = (reg.gender || "").toLowerCase().charAt(0);
    let candidates = ranges.filter((r: any) => {
      const g = (r.gender || "all").toLowerCase();
      if (g === "all") return true;
      if (g === "male" && patientGender === "m") return true;
      if (g === "female" && patientGender === "f") return true;
      return false;
    });
    if (patientAge != null) {
      const ageMatched = candidates.filter((r: any) => {
        if (r.age_min == null && r.age_max == null) return true;
        if (r.age_min != null && patientAge! < r.age_min) return false;
        if (r.age_max != null && patientAge! > r.age_max) return false;
        return true;
      });
      if (ageMatched.length > 0) candidates = ageMatched;
    }
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) {
      return {
        text: "", low: null as number | null, high: null as number | null,
        rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "",
      };
    }
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return {
      text,
      low: best.normal_range_low as number | null,
      high: best.normal_range_high as number | null,
      rangeType: best.range_type || "numeric",
      descriptiveOptions: Array.isArray(best.descriptive_options) ? best.descriptive_options : [],
      expectedValue: best.expected_value || "",
      normalFindings: best.normal_findings || "",
    };
  }, [normalRangesMap]);

  // Build outsourced patient entries (includes naturally outsourced + transferred inhouse tests + parameter-level)
  const patientEntries: OutsourcedPatient[] = useMemo(() => {
    // Build maps from snips
    const transferredKeys = new Set<string>();
    const paramLevelMap: Record<string, string[]> = {};
    existingSnips.forEach((s: any) => {
      const testInfo = testsMap[s.test_id];
      const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
      if (paramIds.length > 0) {
        // Parameter-level outsource
        paramLevelMap[`${s.registration_id}||${s.test_id}`] = paramIds;
      } else if (!testInfo?.is_outsourced) {
        transferredKeys.add(`${s.registration_id}||${s.test_id}`);
      }
    });

    return acceptedRegs.map((reg: any) => {
      const leafSet = leafTestIdsByReg[reg.id] || new Set<string>();
      // Expand PRL/HLT container rows in reg.tests into their leaf tests using sample_tubes
      const expanded = leafSet.size > 0
        ? expandRegistrationTests(reg.tests || [], leafSet, testsMap)
        : ((reg.tests || []) as any[]);
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const outsourcedTests: OutsourcedTest[] = [];
      for (const t of expanded) {
        if (cancelledIds.has(t.test_id)) continue;
        const testInfo = testsMap[t.test_id];
        const testKey = `${reg.id}||${t.test_id}`;
        const isTransferred = transferredKeys.has(testKey);
        const paramIds = paramLevelMap[testKey];

        if (testInfo?.is_outsourced) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "",
            outsourcedCaption: testInfo.outsourced_caption || "Outsourced Lab",
            isTransferredInhouse: false,
            isParameterLevel: false,
          });
        } else if (isTransferred) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo?.test_name || "",
            outsourcedCaption: "Transferred from Inhouse",
            isTransferredInhouse: true,
            isParameterLevel: false,
          });
        } else if (paramIds && paramIds.length > 0) {
          outsourcedTests.push({
            testId: t.test_id,
            testName: t.test_name || testInfo?.test_name || "",
            outsourcedCaption: `${paramIds.length} parameter(s) outsourced`,
            isTransferredInhouse: true,
            isParameterLevel: true,
            outsourcedParameterIds: paramIds,
          });
        }
      }
      return { registration: reg, outsourcedTests };
    }).filter(e => e.outsourcedTests.length > 0);
  }, [acceptedRegs, testsMap, existingSnips, leafTestIdsByReg]);

  // Get snip record
  const getSnip = (regId: string, testId: string) => {
    return existingSnips.find((s: any) => s.registration_id === regId && s.test_id === testId);
  };

  // Get all image URLs for a snip (multi-page support)
  const getSnipImageUrls = (regId: string, testId: string): string[] => {
    return snipImageUrlsFromRow(getSnip(regId, testId));
  };

  const hasManualResults = (regId: string, testId: string) => {
    return existingResults.some((r: any) => r.registration_id === regId && r.test_id === testId && r.result_value);
  };

  // Check if a test has all results filled (no pending params)
  const enterableParamsForTest = (testId: string, outsourcedParamIds?: string[]) => {
    const params = testParamsMap[testId] || [];
    return params.filter((tp: any) => {
      if (tp.is_subheader) return false;
      const p = tp.report_test_parameters;
      if (!p) return false;
      if (outsourcedParamIds && outsourcedParamIds.length > 0 && !outsourcedParamIds.includes(p.id)) return false;
      return true;
    });
  };

  const hasAllResultsFilled = (regId: string, testId: string, outsourcedParamIds?: string[]) => {
    const relevantParams = enterableParamsForTest(testId, outsourcedParamIds);
    if (relevantParams.length === 0) return false;
    return relevantParams.every((tp: any) => {
      const p = tp.report_test_parameters;
      const existing = findPatientResultRow(existingResults, regId, testId, p.id);
      return existing?.result_value && existing.result_value.trim() !== "";
    });
  };

  // Get outsource status from snip record
  const getOutsourceStatus = (regId: string, testId: string) => {
    const snip = getSnip(regId, testId);
    if (!snip) return "pending"; // not yet sent
    return (snip as any).outsource_status || "pending";
  };

  // Get test display status
  const getTestStatus = (regId: string, testId: string) => {
    const outsourceStatus = getOutsourceStatus(regId, testId);
    if (outsourceStatus === "pending") return "not_sent";
    // Tests that have progressed past the results stage — hide from outsourced view
    if (["results_entered", "verified", "approved", "dispatched"].includes(outsourceStatus)) {
      return "completed" as any;
    }
    if (outsourceStatus === "results_saved") {
      // Verify actual data exists — if snip was removed, status may be stale
      const snip = getSnip(regId, testId);
      if (snip?.result_mode === "snip") {
        const imageUrls = getSnipImageUrls(regId, testId);
        if (imageUrls.length === 0) return "awaiting_results";
      }
      if (snip?.result_mode === "manual" && !hasManualResults(regId, testId)) {
        // Status says results_saved but no manual results exist
        return "awaiting_results";
      }
      return "results_saved";
    }

    const snip = getSnip(regId, testId);
    if (snip?.result_mode === "manual" && hasManualResults(regId, testId)) return "results_saved";

    return "awaiting_results"; // sent but still under review until user saves
  };

  // Toggle test selection
  const toggleTestSelection = (regId: string, testId: string) => {
    const key = `${regId}||${testId}`;
    setSelectedTests(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Select all pending tests for a patient
  const toggleAllForPatient = (entry: OutsourcedPatient, checked: boolean) => {
    setSelectedTests(prev => {
      const next = new Set(prev);
      for (const t of entry.outsourcedTests) {
        const key = `${entry.registration.id}||${t.testId}`;
        const status = getTestStatus(entry.registration.id, t.testId);
        if (status === "not_sent") {
          if (checked) next.add(key); else next.delete(key);
        }
      }
      return next;
    });
  };

  // Mark selected tests as sent to outsourced lab
  const markAsSent = async () => {
    if (!labName.trim()) {
      toast.error("Please enter the outsourced lab name");
      return;
    }
    setMarkingSent(true);
    try {
      const entries = Array.from(selectedTests).map(k => {
        const [regId, testId] = k.split("||");
        return { regId, testId };
      });

      let firstAwaitingKey: string | null = null;
      let firstPatientId: string | null = null;

      for (const { regId, testId } of entries) {
        const existing = getSnip(regId, testId);
        const params = testParamsMap[testId] || [];
        const hasParams = params.some((tp: any) => !tp.is_subheader && tp.report_test_parameters);
        // Preserve parameter-level outsource selection if this test was transferred that way
        const existingParamIds = Array.isArray((existing as any)?.outsourced_parameter_ids)
          ? (existing as any).outsourced_parameter_ids
          : null;

        const payload: Record<string, any> = {
          registration_id: regId,
          test_id: testId,
          outsourced_lab_name: labName.trim(),
          outsource_status: "sent",
          // Snip-only tests (no report parameters) should open in snip mode after send
          result_mode: hasParams ? (existing?.result_mode || "manual") : "snip",
          sent_at: new Date().toISOString(),
        };
        if (existingParamIds && existingParamIds.length > 0) {
          payload.outsourced_parameter_ids = existingParamIds;
        }

        const { error } = await supabase
          .from("outsourced_test_snips")
          .upsert(payload as any, { onConflict: "registration_id,test_id" });
        if (error) throw error;

        if (!firstAwaitingKey) {
          firstAwaitingKey = `${regId}||${testId}`;
          firstPatientId = regId;
        }
      }

      toast.success(`${entries.length} test(s) marked as sent to "${labName.trim()}"`);
      setSelectedTests(new Set());
      setShowLabDialog(false);
      setLabName("");
      // Open the first sent test so results / snip entry is immediately available
      if (firstPatientId) setExpandedPatient(firstPatientId);
      if (firstAwaitingKey) setExpandedTest(firstAwaitingKey);
      await qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      await qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to mark tests as sent");
    } finally {
      setMarkingSent(false);
    }
  };

  const clearManualResultsForTest = useCallback(async (regId: string, testId: string, outsourcedParamIds?: string[]) => {
    let q = supabase.from("patient_results")
      .delete()
      .eq("registration_id", regId)
      .eq("test_id", testId)
      .in("status", ["pending", "entered", "results_entered"]);
    if (outsourcedParamIds && outsourcedParamIds.length > 0) {
      q = q.in("parameter_id", outsourcedParamIds);
    }
    const { error } = await q;
    if (error) throw error;
    setEditedValues((prev) => {
      const next = { ...prev };
      if (outsourcedParamIds && outsourcedParamIds.length > 0) {
        outsourcedParamIds.forEach((pid) => { delete next[`${regId}||${pid}`]; });
      } else {
        Object.keys(next).forEach((k) => { if (k.startsWith(`${regId}||`)) delete next[k]; });
      }
      return next;
    });
  }, []);

  // Handle paste from clipboard
  const handlePaste = useCallback(async (regId: string, testId: string, event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const key = `${regId}||${testId}`;
        setUploadingKey(key);
        try {
          const fileName = `${regId}_${testId}_${Date.now()}.png`;
          const { error: uploadError } = await supabase.storage
            .from("outsourced-snips")
            .upload(fileName, file, { contentType: "image/png", upsert: true });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from("outsourced-snips").getPublicUrl(fileName);
          // Append to existing URLs array
          const existingUrls = getSnipImageUrls(regId, testId);
          const newUrls = [...existingUrls, urlData.publicUrl];
          const { error: upsertErr } = await supabase.from("outsourced_test_snips").upsert({
            registration_id: regId,
            test_id: testId,
            snip_image_url: newUrls[0],
            snip_image_urls: newUrls,
            result_mode: "snip",
            outsource_status: "sent",
          } as any, { onConflict: "registration_id,test_id" });
          if (upsertErr) throw upsertErr;
          const snipRow = getSnip(regId, testId);
          const paramIds = Array.isArray((snipRow as any)?.outsourced_parameter_ids)
            ? (snipRow as any).outsourced_parameter_ids
            : undefined;
          await clearManualResultsForTest(regId, testId, paramIds);
          toast.success(`Page ${newUrls.length} added successfully`);
          qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
          qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
          qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
        } catch (err: any) {
          toast.error(err.message || "Failed to upload snip");
        } finally {
          setUploadingKey(null);
        }
        return;
      }
    }
  }, [qc, existingSnips, clearManualResultsForTest]);

  // Handle file upload
  const handleFileUpload = useCallback(async (regId: string, testId: string, file: File) => {
    const key = `${regId}||${testId}`;
    setUploadingKey(key);
    try {
      const fileName = `${regId}_${testId}_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from("outsourced-snips")
        .upload(fileName, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("outsourced-snips").getPublicUrl(fileName);
      // Append to existing URLs array
      const existingUrls = getSnipImageUrls(regId, testId);
      const newUrls = [...existingUrls, urlData.publicUrl];
      const { error: upsertErr } = await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        snip_image_url: newUrls[0],
        snip_image_urls: newUrls,
        result_mode: "snip",
        outsource_status: "sent",
      } as any, { onConflict: "registration_id,test_id" });
      if (upsertErr) throw upsertErr;
      const snipRow = getSnip(regId, testId);
      const paramIds = Array.isArray((snipRow as any)?.outsourced_parameter_ids)
        ? (snipRow as any).outsourced_parameter_ids
        : undefined;
      await clearManualResultsForTest(regId, testId, paramIds);
      toast.success(`Page ${newUrls.length} added successfully`);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      setUploadingKey(null);
    }
  }, [qc, existingSnips, clearManualResultsForTest]);

  // Delete a specific snip page
  const deleteSnipPage = useCallback(async (regId: string, testId: string, pageIndex: number) => {
    try {
      const existing = getSnip(regId, testId);
      const currentUrls = getSnipImageUrls(regId, testId);
      const newUrls = currentUrls.filter((_, i) => i !== pageIndex);
      const oldScales = Array.isArray((existing as any)?.snip_page_scales) ? (existing as any).snip_page_scales : [];
      const newScales = oldScales.filter((_: unknown, i: number) => i !== pageIndex);
      if (newUrls.length === 0) {
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: null,
          snip_image_urls: [],
          snip_page_scales: [],
          result_mode: "manual",
          outsource_status: "sent",
        } as any).eq("registration_id", regId).eq("test_id", testId);
        setModeOverride((prev) => ({ ...prev, [`${regId}||${testId}`]: "manual" }));
        toast.success("All pages removed — test moved back to awaiting results");
      } else {
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: newUrls[0],
          snip_image_urls: newUrls,
          snip_page_scales: newScales,
        } as any).eq("registration_id", regId).eq("test_id", testId);
        toast.success(`Page ${pageIndex + 1} removed`);
      }
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error("Failed to delete page");
    }
  }, [qc, existingSnips]);

  // Soft mode hints only — typed params and snips may coexist.
  const setManualMode = useCallback(async (regId: string, testId: string) => {
    try {
      const existing = getSnip(regId, testId);
      const urls = snipImageUrlsFromRow(existing);
      const { error } = await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        result_mode: urls.length > 0 ? "snip" : "manual",
        outsource_status: (existing as any)?.outsource_status || "sent",
      } as any, { onConflict: "registration_id,test_id" });
      if (error) throw error;
      setModeOverride((prev) => ({ ...prev, [`${regId}||${testId}`]: "manual" }));
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to open typed entry");
    }
  }, [qc, existingSnips]);

  const setSnipMode = useCallback(async (regId: string, testId: string, _outsourcedParamIds?: string[]) => {
    try {
      const existing = getSnip(regId, testId);
      const { error } = await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        result_mode: "snip",
        outsource_status: (existing as any)?.outsource_status || "sent",
      } as any, { onConflict: "registration_id,test_id" });
      if (error) throw error;
      setModeOverride((prev) => ({ ...prev, [`${regId}||${testId}`]: "snip" }));
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to open snip entry");
    }
  }, [qc, existingSnips]);

  // Save typed (+ optional snip) results and transfer straight to Verification
  const saveManualResults = useCallback(async (regId: string, testId: string, testName: string, outsourcedParamIds?: string[], reg?: any) => {
    const key = `${regId}||${testId}`;
    setSavingKey(key);
    try {
      const params = testParamsMap[testId] || [];
      const upserts: any[] = [];
      for (const tp of params) {
        if (tp.is_subheader) continue;
        const p = tp.report_test_parameters;
        if (!p) continue;
        if (outsourcedParamIds && outsourcedParamIds.length > 0 && !outsourcedParamIds.includes(p.id)) continue;
        const valKey = `${regId}||${p.id}`;
        const existing = findPatientResultRow(existingResults, regId, testId, p.id);
        const value = editedValues[valKey] !== undefined ? editedValues[valKey] : (existing?.result_value || "");
        if (!value || !String(value).trim()) continue;
        const resolved = reg ? resolveNormalRange(p.id, reg) : {
          text: "", low: null as number | null, high: null as number | null,
          rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "",
        };
        const rangeLow = resolved.low ?? p.normal_range_low;
        const rangeHigh = resolved.high ?? p.normal_range_high;
        const masterRef = resolved.text || p.normal_range_text || (rangeLow != null && rangeHigh != null ? `${rangeLow} - ${rangeHigh}` : "");
        const unit = resolveOutsourcedUnit({
          isOutsourced: true,
          editedUnit: editedUnits[valKey],
          savedUnit: existing?.unit,
          masterUnit: p.unit || "",
        });
        const refRange = resolveOutsourcedRefRange({
          isOutsourced: true,
          editedRef: editedRefRanges[valKey],
          savedRef: existing?.reference_range,
          masterRef,
          rangeType: resolved.rangeType,
          normalRangeText: resolved.text || p.normal_range_text,
        });
        const autoFlag = calculateResultFlag({
          value,
          low: rangeLow,
          high: rangeHigh,
          rangeType: resolved.rangeType,
          expectedValue: resolved.expectedValue,
          descriptiveOptions: resolved.descriptiveOptions,
          normalRangeText: resolved.text || p.normal_range_text,
          normalFindings: resolved.normalFindings,
          unit,
        });
        const flag = resolveOutsourcedFlag({
          isOutsourced: true,
          editedFlag: editedFlags[valKey],
          savedFlag: existing?.flag,
          autoFlag,
          currentValue: value,
          savedValue: existing?.result_value,
        });
        upserts.push({
          registration_id: regId, test_id: testId, parameter_id: p.id,
          param_code: p.param_code, parameter_name: p.parameter_name,
          result_value: value, unit,
          reference_range: refRange,
          normal_range_low: rangeLow, normal_range_high: rangeHigh,
          flag: flag || null,
          status: "entered",
          entered_at: new Date().toISOString(),
          entered_by: getCurrentUserName(),
          is_calculated: false, is_from_interface: false,
        });
      }
      if (upserts.length > 0) {
        const paramIdsToReplace = upserts.map((u) => u.parameter_id);
        const { error: delErr } = await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", regId)
          .eq("test_id", testId)
          .in("parameter_id", paramIdsToReplace)
          .in("status", ["pending", "entered", "results_entered"]);
        if (delErr) throw delErr;
        const { error } = await supabase.from("patient_results").insert(upserts as any);
        if (error) throw error;
      }
      const existingSnip = getSnip(regId, testId);
      const keepUrls = snipImageUrlsFromRow(existingSnip);
      if (upserts.length === 0 && keepUrls.length === 0) {
        toast.error("Enter parameter values and/or attach snip images before saving");
        return;
      }
      const { error: snipErr } = await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId, test_id: testId,
        result_mode: keepUrls.length > 0 ? "snip" : "manual",
        outsource_status: "results_entered",
        snip_image_url: keepUrls[0] || null,
        snip_image_urls: keepUrls,
        entered_at: new Date().toISOString(),
        entered_by: getCurrentUserName(),
      } as any, { onConflict: "registration_id,test_id" });
      if (snipErr) throw snipErr;

      await recalculateRegistrationStatus(regId);

      toast.success(`Results saved — ${testName} moved to Verification`);
      const clearKeys = (prev: Record<string, string>) => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { if (k.startsWith(`${regId}||`)) delete next[k]; });
        return next;
      };
      setEditedValues(clearKeys);
      setEditedUnits(clearKeys);
      setEditedRefRanges(clearKeys);
      setEditedFlags(clearKeys);
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
      qc.invalidateQueries({ queryKey: ["outsourced_pending_ids"] });
      qc.invalidateQueries({ queryKey: ["verification_results"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced"] });
      qc.invalidateQueries({ queryKey: ["verification_pending_ids"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save results");
    } finally {
      setSavingKey(null);
    }
  }, [editedValues, editedUnits, editedRefRanges, editedFlags, testParamsMap, qc, resolveNormalRange, existingSnips, existingResults]);

  // Save snip results and transfer to Verification (also persists any typed values currently entered)
  const saveSnipResults = useCallback(async (regId: string, testId: string, testName: string, outsourcedParamIds?: string[], reg?: any) => {
    await saveManualResults(regId, testId, testName, outsourcedParamIds, reg);
  }, [saveManualResults]);
  const saveEditLabName = async () => {
    if (!editLabKey || !editLabName.trim()) return;
    setSavingEditLab(true);
    try {
      const [regId, testId] = editLabKey.split("||");
      await supabase.from("outsourced_test_snips").update({
        outsourced_lab_name: editLabName.trim(),
      } as any).eq("registration_id", regId).eq("test_id", testId);
      toast.success("Outsourced lab name updated");
      setEditLabKey(null);
      setEditLabName("");
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSavingEditLab(false);
    }
  };

  // Format sent_at date/time
  const formatSentAt = (sentAt: string | null) => {
    if (!sentAt) return null;
    try {
      const d = new Date(sentAt);
      return format(d, "dd-MM-yyyy hh:mm a");
    } catch { return null; }
  };

  // Status badge renderer
  const renderStatusBadge = (regId: string, testId: string) => {
    const status = getTestStatus(regId, testId);
    const snip = getSnip(regId, testId);
    const labNameVal = (snip as any)?.outsourced_lab_name;
    const sentAt = formatSentAt((snip as any)?.sent_at);

    switch (status) {
      case "not_sent":
        return <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">Not Sent</Badge>;
      case "awaiting_results":
        return (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge className="text-xs bg-amber-500 text-white gap-1">
              <Clock className="h-3 w-3" /> Awaiting Results
            </Badge>
            {labNameVal && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                {labNameVal}
                <button onClick={(e) => { e.stopPropagation(); setEditLabKey(`${regId}||${testId}`); setEditLabName(labNameVal); }} className="hover:text-primary">
                  <Pencil className="h-3 w-3" />
                </button>
              </span>
            )}
            {sentAt && <span className="text-[10px] text-muted-foreground">{sentAt}</span>}
          </div>
        );
      case "results_saved":
        return (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge className="text-xs bg-green-600 text-white gap-1">
              <CheckCircle2 className="h-3 w-3" /> Results Saved
            </Badge>
            {labNameVal && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                {labNameVal}
                <button onClick={(e) => { e.stopPropagation(); setEditLabKey(`${regId}||${testId}`); setEditLabName(labNameVal); }} className="hover:text-primary">
                  <Pencil className="h-3 w-3" />
                </button>
              </span>
            )}
            {sentAt && <span className="text-[10px] text-muted-foreground">{sentAt}</span>}
          </div>
        );
      default:
        return null;
    }
  };

  // Count stats — only count tests still in the results section (not yet transferred to verification)
  const stats = useMemo(() => {
    let notSent = 0, awaiting = 0;
    let resultsSaved = 0;
    for (const e of patientEntries) {
      for (const t of e.outsourcedTests) {
        // Skip tests that have already moved past results section
        const snip = getSnip(e.registration.id, t.testId);
        if (snip && ["results_entered", "entered", "verified", "approved"].includes(snip.outsource_status)) continue;

        const s = getTestStatus(e.registration.id, t.testId);
        // results_saved always counts — draft or Verification send-back
        if (s === "not_sent") notSent++;
        else if (s === "awaiting_results") awaiting++;
        else if (s === "results_saved") resultsSaved++;
      }
    }
    return { notSent, awaiting, resultsSaved };
  }, [patientEntries, existingSnips, existingResults, testParamsMap]);

  // Render test card
  const renderTestCard = (entry: OutsourcedPatient, test: OutsourcedTest) => {
    const regId = entry.registration.id;
    const testId = test.testId;
    const testKey = `${regId}||${testId}`;
    const isExpanded = expandedTest === testKey;
    const snip = getSnip(regId, test.testId);
    const status = getTestStatus(regId, test.testId);
    const params = testParamsMap[test.testId] || [];
    const linkedParams = params.filter((tp: any) => !tp.is_subheader && tp.report_test_parameters);
    // For parameter-level outsource, only linked outsourced params count as "enterable"
    const enterableParams = test.isParameterLevel && test.outsourcedParameterIds?.length
      ? linkedParams.filter((tp: any) => test.outsourcedParameterIds!.includes(tp.report_test_parameters.id))
      : linkedParams;
    const hasParams = enterableParams.length > 0;
    const isUploading = uploadingKey === testKey;
    const isSaving = savingKey === testKey;
    // Prefer snip when there are no enterable parameters (snip-only / misconfigured tests)
    const currentMode = !hasParams
      ? "snip"
      : (modeOverride[testKey] || snip?.result_mode || "manual");
    const isSelected = selectedTests.has(testKey);
    const canSelect = status === "not_sent";
    const canEnterResults = status === "awaiting_results" || status === "results_saved";

    return (
      <div key={testKey} className="border rounded-lg overflow-hidden">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => {
            if (canEnterResults) {
              setExpandedTest(isExpanded ? null : testKey);
            }
          }}
        >
          {/* Checkbox for not-sent tests */}
          {canSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleTestSelection(regId, test.testId)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
            />
          )}
          {canEnterResults && (
            isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <div className="flex-1">
            <span className="font-medium text-sm">{test.testName}</span>
            <span className="text-xs text-muted-foreground ml-2">({test.outsourcedCaption})</span>
            {test.isParameterLevel && (
              <Badge variant="outline" className="ml-2 text-[10px]">Param Level</Badge>
            )}
            {!hasParams && status !== "not_sent" && (
              <Badge variant="outline" className="ml-2 text-[10px] text-amber-700 border-amber-300">Snip only</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEnterResults && hasParams && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedTest(testKey);
                  setSnipMode(regId, test.testId, test.outsourcedParameterIds);
                }}
              >
                <Image className="h-3.5 w-3.5" />
                Add snipped image
              </Button>
            )}
            {test.isTransferredInhouse && !test.isParameterLevel && status !== "results_saved" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-primary"
                disabled={returningKey === testKey}
                onClick={(e) => {
                  e.stopPropagation();
                  returnToInhouse(regId, test.testId, test.testName);
                }}
              >
                {returningKey === testKey ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowLeftRight className="h-3 w-3" />
                )}
                Return to Inhouse
              </Button>
            )}
            {renderStatusBadge(regId, test.testId)}
          </div>
        </div>

        {/* Parameter-level: show individual outsourced parameters with return buttons */}
        {test.isParameterLevel && test.outsourcedParameterIds && test.outsourcedParameterIds.length > 0 && (
          <div className="border-t px-3 py-2 bg-muted/5">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Outsourced Parameters:</div>
            <div className="flex flex-wrap gap-1.5">
              {test.outsourcedParameterIds.map((paramId: string) => {
                const paramInfo = (testParamsMap[test.testId] || []).find(
                  (tp: any) => !tp.is_subheader && tp.report_test_parameters?.id === paramId
                );
                const paramName = paramInfo?.report_test_parameters?.parameter_name || paramId;
                const isReturning = returningKey === `${regId}||${paramId}`;
                return (
                  <div key={paramId} className="flex items-center gap-1 border rounded px-2 py-0.5 bg-background text-xs">
                    <span>{paramName}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-4 w-4 p-0 text-muted-foreground hover:text-primary"
                      title="Return to Inhouse"
                      disabled={isReturning}
                      onClick={(e) => {
                        e.stopPropagation();
                        returnParamToInhouse(regId, test.testId, paramId, paramName);
                      }}
                    >
                      {isReturning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowLeftRight className="h-3 w-3" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {canEnterResults && (
          <div className="border-t p-3 space-y-3 bg-muted/10">
            {!hasParams && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                No report parameters are linked for this test. Use <strong>Add snipped image</strong> to attach the outsourced report, then Save.
              </div>
            )}
            {hasParams && (
              <div className="rounded-md border border-blue-200 bg-blue-50/80 p-2 space-y-2">
                <div className="text-xs font-medium text-blue-900">
                  Outsourced result — enter parameter values and/or attach snipped images. Both appear on the report (parameters first, then snips).
                </div>
              </div>
            )}
            {hasParams && (
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs w-[70px]">Code</TableHead>
                        <TableHead className="py-1 text-xs">Parameter</TableHead>
                        <TableHead className="py-1 text-xs w-[140px]">Result</TableHead>
                        <TableHead className="py-1 text-xs w-[80px]">Unit</TableHead>
                        <TableHead className="py-1 text-xs w-[180px]">Ref. Range</TableHead>
                        <TableHead className="py-1 text-xs w-[80px] text-center">Flag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {params.map((tp: any) => {
                        if (tp.is_subheader) {
                          if (test.isParameterLevel) return null;
                          return (
                            <TableRow key={tp.id || tp.subheader_text}>
                              <TableCell colSpan={6} className="py-1 text-xs font-semibold text-primary bg-muted/30">
                                {tp.subheader_text}
                              </TableCell>
                            </TableRow>
                          );
                        }
                        const p = tp.report_test_parameters;
                        if (!p) return null;
                        if (test.isParameterLevel && test.outsourcedParameterIds && !test.outsourcedParameterIds.includes(p.id)) {
                          return null;
                        }
                        const valKey = `${regId}||${p.id}`;
                        const existing = findPatientResultRow(existingResults, regId, testId, p.id);
                        if (existing && ["verified", "approved", "dispatched"].includes(existing.status) && editedValues[valKey] === undefined) {
                          return null;
                        }
                        const currentValue = editedValues[valKey] !== undefined ? editedValues[valKey] : (existing?.result_value || "");
                        const resolved = resolveNormalRange(p.id, entry.registration);
                        const masterRef = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
                        const displayUnit = resolveOutsourcedUnit({
                          isOutsourced: true,
                          editedUnit: editedUnits[valKey],
                          savedUnit: loadOutsourcedUnit(true, existing, p.unit || ""),
                          masterUnit: p.unit || "",
                        });
                        const displayRef = resolveOutsourcedRefRange({
                          isOutsourced: true,
                          editedRef: editedRefRanges[valKey],
                          savedRef: loadOutsourcedRefRange(true, existing, masterRef, resolved.rangeType, resolved.text || p.normal_range_text),
                          masterRef,
                          rangeType: resolved.rangeType,
                          normalRangeText: resolved.text || p.normal_range_text,
                        });
                        const autoFlag = calculateResultFlag({
                          value: currentValue,
                          low: resolved.low ?? p.normal_range_low,
                          high: resolved.high ?? p.normal_range_high,
                          rangeType: resolved.rangeType,
                          expectedValue: resolved.expectedValue,
                          descriptiveOptions: resolved.descriptiveOptions,
                          normalRangeText: resolved.text || p.normal_range_text,
                          normalFindings: resolved.normalFindings,
                          unit: displayUnit,
                        });
                        const flag = resolveOutsourcedFlag({
                          isOutsourced: true,
                          editedFlag: editedFlags[valKey],
                          savedFlag: existing?.flag,
                          autoFlag,
                          currentValue,
                          savedValue: existing?.result_value,
                        });

                        return (
                          <TableRow key={valKey}>
                            <TableCell className="py-1 text-xs font-mono text-muted-foreground">{p.param_code}</TableCell>
                            <TableCell className="py-1 text-sm">{p.parameter_name}</TableCell>
                            <TableCell className="py-1">
                              <Input
                                value={currentValue}
                                onChange={e => setEditedValues(prev => ({ ...prev, [valKey]: e.target.value }))}
                                className={`h-7 text-sm ${flag === "H" || flag === "L" || flag === "A" || flag === "X" ? "border-destructive text-destructive font-bold" : ""}`}
                                placeholder="Enter result"
                              />
                            </TableCell>
                            <TableCell className="py-1">
                              <Input
                                value={displayUnit}
                                onChange={e => setEditedUnits(prev => ({ ...prev, [valKey]: e.target.value }))}
                                className="h-7 text-xs w-[70px]"
                                placeholder="Unit"
                              />
                            </TableCell>
                            <TableCell className="py-1">
                              <Textarea
                                value={displayRef}
                                onChange={e => setEditedRefRanges(prev => ({ ...prev, [valKey]: e.target.value }))}
                                className="min-h-[2.5rem] text-xs w-[180px] whitespace-pre-wrap resize-y"
                                placeholder="Normal / advisory range"
                              />
                            </TableCell>
                            <TableCell className="py-1 text-center">
                              <Select
                                value={flag || "none"}
                                onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [valKey]: v === "none" ? "" : v }))}
                              >
                                <SelectTrigger className="h-7 text-xs w-[80px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">—</SelectItem>
                                  <SelectItem value="N">Normal</SelectItem>
                                  <SelectItem value="H">HIGH</SelectItem>
                                  <SelectItem value="L">LOW</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm"
                      onClick={() => saveManualResults(regId, test.testId, test.testName, test.outsourcedParameterIds, entry.registration)}
                      disabled={isSaving}
                    >
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      Save Results
                    </Button>
                  </div>
                </div>
            )}

            {(
              <div className="mt-2 space-y-3">
                <SnipOnLetterhead
                  regId={regId}
                  testId={testId}
                  imageUrls={getSnipImageUrls(regId, testId)}
                  isUploading={isUploading}
                  onPaste={handlePaste}
                  onFileUpload={handleFileUpload}
                  onDeletePage={deleteSnipPage}
                  initialPageScales={(snip as any)?.snip_page_scales}
                  initialTopMarginPct={(snip as any)?.top_margin_pct}
                />
                {getSnipImageUrls(regId, testId).length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveSnipResults(regId, testId, test.testName, test.outsourcedParameterIds, entry.registration)}
                      disabled={savingKey === `${regId}||${testId}`}
                    >
                      {savingKey === `${regId}||${testId}` ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      Save Results
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Not Sent</div>
          <div className="text-xl font-bold text-muted-foreground">{stats.notSent}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Awaiting Results</div>
          <div className="text-xl font-bold text-amber-600">{stats.awaiting}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Results Saved</div>
          <div className="text-xl font-bold text-green-600">{stats.resultsSaved}</div>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {selectedTests.size > 0 && (
          <Button onClick={() => setShowLabDialog(true)} className="gap-1.5">
            <Send className="h-4 w-4" />
            Mark {selectedTests.size} Test{selectedTests.size > 1 ? "s" : ""} as Sent
          </Button>
        )}
      </div>

      {/* Patient list */}
      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : patientEntries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No outsourced tests found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {patientEntries.map(entry => {
            const reg = entry.registration;
            // Filter out tests where all results are already filled AND finalised
            const visibleTests = entry.outsourcedTests.filter(t => {
              const status = getTestStatus(reg.id, t.testId);
              // Hide only after transfer to Verification (or later stages).
              // results_saved must stay visible — that is the Outsourced draft /
              // Verification send-back state (params and/or snips ready to edit).
              if (status === "completed") return false;
              return true;
            });
            if (visibleTests.length === 0) return null;
            const isExpanded = expandedPatient === reg.id;
            const notSentCount = visibleTests.filter(t => getTestStatus(reg.id, t.testId) === "not_sent").length;
            const awaitingCount = visibleTests.filter(t => getTestStatus(reg.id, t.testId) === "awaiting_results").length;
            const allNotSentSelected = visibleTests
              .filter(t => getTestStatus(reg.id, t.testId) === "not_sent")
              .every(t => selectedTests.has(`${reg.id}||${t.testId}`));

            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}
                >
                  {/* Select all checkbox for not-sent tests */}
                  {notSentCount > 0 && (
                    <Checkbox
                      checked={allNotSentSelected && notSentCount > 0}
                      onCheckedChange={(checked) => toggleAllForPatient(entry, !!checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      {reg.status !== "sample_accepted" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">{patientDisplayName(reg)}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{formatAgeGender(reg.dob, reg.gender, reg.age_text)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reg.mobile_number} • {entry.outsourcedTests.length} test{entry.outsourcedTests.length > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {notSentCount > 0 && <Badge variant="outline" className="text-[10px]">{notSentCount} Not Sent</Badge>}
                    {awaitingCount > 0 && <Badge className="text-[10px] bg-amber-500">{awaitingCount} Awaiting</Badge>}
                    
                  </div>
                </div>
                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-3 space-y-2">
                    {visibleTests.map(test => renderTestCard(entry, test))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {osTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" disabled={osPage === 0} onClick={() => setOsPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {osPage + 1} of {osTotalPages} ({osCount} total)</span>
          <Button variant="outline" size="sm" disabled={osPage >= osTotalPages - 1} onClick={() => setOsPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Lab Name Dialog */}
      <Dialog open={showLabDialog} onOpenChange={setShowLabDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Sent to Outsourced Lab</DialogTitle>
            <DialogDescription>
              Enter the name of the outsourced lab where {selectedTests.size} test{selectedTests.size > 1 ? "s are" : " is"} being sent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Outsourced Lab</Label>
            <Select value={labName} onValueChange={setLabName}>
              <SelectTrigger>
                <SelectValue placeholder="Select outsourced lab" />
              </SelectTrigger>
              <SelectContent>
                {outsourceLabs.map(lab => (
                  <SelectItem key={lab.id} value={lab.value}>{lab.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {outsourceLabs.length === 0 && (
              <p className="text-xs text-muted-foreground">No labs configured. Add them in Test Management → Settings → Outsource Labs.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLabDialog(false)}>Cancel</Button>
            <Button onClick={markAsSent} disabled={markingSent || !labName.trim()} className="gap-1.5">
              {markingSent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirm & Mark Sent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!modeSwitchConfirm} onOpenChange={(open) => { if (!open) setModeSwitchConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {modeSwitchConfirm?.to === "snip" ? "Switch to snipped image?" : "Switch to manual entry?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {modeSwitchConfirm?.to === "snip"
                ? `Typed results for ${modeSwitchConfirm?.testName || "this test"} will be removed. You can only keep a snipped image or manual values — not both.`
                : `Snipped images for ${modeSwitchConfirm?.testName || "this test"} will be removed. You can only keep manual values or a snipped image — not both.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!modeSwitchConfirm) return;
                const { regId, testId, to, outsourcedParamIds } = modeSwitchConfirm;
                if (to === "manual") setManualMode(regId, testId);
                else setSnipMode(regId, testId, outsourcedParamIds);
                setModeSwitchConfirm(null);
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Lab Name Dialog */}
      <Dialog open={!!editLabKey} onOpenChange={(open) => { if (!open) { setEditLabKey(null); setEditLabName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Outsourced Lab Name</DialogTitle>
            <DialogDescription>Select the correct outsourced lab name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Outsourced Lab</Label>
            <Select value={editLabName} onValueChange={setEditLabName}>
              <SelectTrigger>
                <SelectValue placeholder="Select outsourced lab" />
              </SelectTrigger>
              <SelectContent>
                {outsourceLabs.map(lab => (
                  <SelectItem key={lab.id} value={lab.value}>{lab.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditLabKey(null); setEditLabName(""); }}>Cancel</Button>
            <Button onClick={saveEditLabName} disabled={savingEditLab || !editLabName.trim()} className="gap-1.5">
              {savingEditLab ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update Lab Name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OutsourcedResults;
