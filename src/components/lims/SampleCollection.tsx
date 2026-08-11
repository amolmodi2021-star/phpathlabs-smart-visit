import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, Printer, ChevronDown, ChevronUp, CheckCircle2, RotateCcw, Undo2, Clock, Loader2, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { getCurrentUserName } from "@/lib/auth";
import { printBarcodes } from "@/lib/barcodePrint";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { shortIdsKey } from "@/lib/queryKeys";

import { buildSampleTubeGroups, TubeGroupingItem } from "@/lib/sampleTubeGrouping";
import { prepareTubesForCollectionVisit } from "@/lib/sampleTubeSplit";
import { formatAgeGender } from "@/lib/ageGender";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import NewBadge from "./NewBadge";

const LIST_BATCH = 10;

/** Tiny index for queue membership — no tube JSON / names. */
const TUBE_INDEX_SELECT = "registration_id, status, created_at";

/** Tubes for the visible page / expand actions. */
const TUBE_DETAIL_SELECT =
  "id, sample_uid, registration_id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status, collected_at, created_at";

/** List headers — no tests/payments JSON (egress). */
const REG_LIST_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, dob, gender, visit_type, is_stat, status, created_at, bill_cancelled, cancelled_tests, repeat_tests";

const TUBE_COLOR_MAP: Record<string, string> = {
  red: "#e53e3e", lavender: "#b794f4", purple: "#9f7aea", yellow: "#ecc94b",
  green: "#48bb78", blue: "#4299e1", grey: "#a0aec0", gray: "#a0aec0",
  white: "#ffffff", orange: "#ed8936", pink: "#ed64a6", black: "#1a202c",
};

interface SampleTubeRow {
  id: string;
  sample_uid: string;
  registration_id: string;
  tube_type: string | null;
  tube_color: string | null;
  sample_type: string | null;
  suffix: string | null;
  test_ids: string[];
  test_names: string[];
  status: string;
  collected_at: string | null;
  accepted_at?: string | null;
  created_at: string;
}

interface GroupedRegistration {
  registration: any;
  tubes: SampleTubeRow[];
}

type CollectionTab = "pending" | "deferred" | "collected";

const SampleCollection = () => {
  const qc = useQueryClient();
  useLimsPipelineRealtime("sample_collection");
  const [activeTab, setActiveTab] = useState<CollectionTab>("pending");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(LIST_BATCH);
  /** Off by default (14-day window). On = all pending/collected tubes still in pipeline. */
  const [showOlderPending, setShowOlderPending] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedTubes, setSelectedTubes] = useState<Record<string, Set<string>>>({});
  /** Per-tube: which leaf tests to collect on this visit (missing = all tests on that tube) */
  const [collectNowTests, setCollectNowTests] = useState<Record<string, Set<string>>>({});
  const printRef = useRef<HTMLDivElement>(null);

  // Reprint dialog state
  const [reprintDialog, setReprintDialog] = useState<{ open: boolean; reg: any; tubes: SampleTubeRow[] }>({ open: false, reg: null, tubes: [] });
  const [reprintReason, setReprintReason] = useState("");
  const [reprintSelectedTubes, setReprintSelectedTubes] = useState<Set<string>>(new Set());

  // Cancel collection (revert to pending) dialog state
  const [cancelCollectDialog, setCancelCollectDialog] = useState<{ open: boolean; reg: any; tube: SampleTubeRow | null }>({ open: false, reg: null, tube: null });

  // Print confirmation dialog state — shown before any print action
  const [printConfirmDialog, setPrintConfirmDialog] = useState<{ open: boolean; reg: any; tubes: SampleTubeRow[]; action: (() => void) | null }>({ open: false, reg: null, tubes: [], action: null });

  // After selecting tubes to print/collect: optionally defer the rest for a later visit
  const [deferRemainderDialog, setDeferRemainderDialog] = useState<{
    open: boolean;
    reg: any;
    selected: SampleTubeRow[];
    remainder: SampleTubeRow[];
  }>({ open: false, reg: null, selected: [], remainder: [] });

  const getBarcodeLabel = (reg: any, tube: SampleTubeRow) => {
    const suffix = tube.suffix?.trim();
    return suffix ? `${reg.invoice_number}${suffix}` : String(reg.invoice_number);
  };

  const runSearch = () => {
    setAppliedSearch(search.trim());
    setVisibleLimit(LIST_BATCH);
    setExpandedRow(null);
  };

  const clearSearch = () => {
    setSearch("");
    setAppliedSearch("");
    setVisibleLimit(LIST_BATCH);
    setExpandedRow(null);
  };

  // Lean tube index for queue membership (tiny payload vs select("*")).
  const { data: tubeIndex = [], isLoading: loadingIndex } = useQuery({
    queryKey: ["sample_tubes_collection", showOlderPending],
    queryFn: async () => {
      let q = supabase
        .from("sample_tubes" as any)
        .select(TUBE_INDEX_SELECT)
        .in("status", ["pending", "deferred", "collected"])
        .order("created_at", { ascending: false })
        .limit(showOlderPending ? 2000 : 500);
      if (!showOlderPending) {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        q = q.gte("created_at", fourteenDaysAgo.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as { registration_id: string; status: string; created_at: string }[];
    },
    staleTime: 120_000,
  });

  const idsByStatus = useMemo(() => {
    const pending: string[] = [];
    const deferred: string[] = [];
    const collected: string[] = [];
    const seenP = new Set<string>();
    const seenD = new Set<string>();
    const seenC = new Set<string>();
    // tubeIndex is newest-first — preserve first-seen order
    for (const t of tubeIndex) {
      if (t.status === "pending" && !seenP.has(t.registration_id)) {
        seenP.add(t.registration_id);
        pending.push(t.registration_id);
      } else if (t.status === "deferred" && !seenD.has(t.registration_id)) {
        seenD.add(t.registration_id);
        deferred.push(t.registration_id);
      } else if (t.status === "collected" && !seenC.has(t.registration_id)) {
        seenC.add(t.registration_id);
        collected.push(t.registration_id);
      }
    }
    return { pending, deferred, collected };
  }, [tubeIndex]);

  const activeCandidateIds = idsByStatus[activeTab];

  const { data: searchMatchedIds, isFetching: searchingIds } = useQuery({
    queryKey: ["sample_collection_search", activeTab, appliedSearch, shortIdsKey(activeCandidateIds, "sc")],
    enabled: !!appliedSearch && activeCandidateIds.length > 0,
    queryFn: async () => {
      const matched = new Set<string>();
      const chunkSize = 100;
      for (let i = 0; i < activeCandidateIds.length; i += chunkSize) {
        const chunk = activeCandidateIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("patient_registrations")
          .select("id")
          .in("id", chunk)
          .eq("bill_cancelled", false)
          .or(
            `patient_name.ilike.%${appliedSearch}%,mobile_number.ilike.%${appliedSearch}%,invoice_number.ilike.%${appliedSearch}%`
          );
        if (error) throw error;
        (data || []).forEach((r: any) => matched.add(r.id as string));
      }
      return activeCandidateIds.filter((id) => matched.has(id));
    },
    staleTime: 120_000,
  });

  const orderedIds = appliedSearch ? (searchMatchedIds || []) : activeCandidateIds;
  const pageIds = orderedIds.slice(0, visibleLimit);
  const pageKey = shortIdsKey(pageIds, "sc-p");
  const hasMore = pageIds.length < orderedIds.length;

  const { data: registrations = [], isLoading: loadingRegs, isFetching: fetchingRegs } = useQuery({
    queryKey: ["sample_collection_regs", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(REG_LIST_SELECT)
        .in("id", pageIds)
        .eq("bill_cancelled", false);
      if (error) throw error;
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      const rows = ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      rows.sort((a: any, b: any) => {
        const aUrgent = a.is_stat ? 1 : 0;
        const bUrgent = b.is_stat ? 1 : 0;
        if (bUrgent !== aUrgent) return bUrgent - aUrgent;
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      });
      return rows;
    },
    staleTime: 120_000,
  });

  const { data: pageTubes = [], isLoading: loadingTubes, isFetching: fetchingTubes } = useQuery({
    queryKey: ["sample_collection_page_tubes", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sample_tubes" as any)
        .select(TUBE_DETAIL_SELECT)
        .in("registration_id", pageIds)
        .in("status", ["pending", "deferred", "collected"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SampleTubeRow[];
    },
    staleTime: 120_000,
  });

  // Extract cancelled test IDs set from a registration
  const getCancelledIds = (reg: any): Set<string> => {
    const cancelledTests = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
    return new Set(
      cancelledTests
        .map((item: any) => (typeof item === "string" ? item : item?.test_id))
        .filter(Boolean)
    );
  };

  // Helper: check if a tube's test_ids are all cancelled
  const isTubeFullyCancelled = (tube: SampleTubeRow, reg: any): boolean => {
    const cancelledIds = getCancelledIds(reg);
    if (cancelledIds.size === 0) return false;
    const testIds = Array.isArray(tube.test_ids) ? tube.test_ids : [];
    return testIds.length > 0 && testIds.every(id => cancelledIds.has(id));
  };

  // Helper: get only the active (non-cancelled) test names for a tube
  const getActiveTestNames = (tube: SampleTubeRow, reg: any): string[] => {
    const cancelledIds = getCancelledIds(reg);
    if (cancelledIds.size === 0) return tube.test_names || [];
    const testIds = Array.isArray(tube.test_ids) ? tube.test_ids : [];
    const testNames = Array.isArray(tube.test_names) ? tube.test_names : [];
    return testIds.reduce<string[]>((acc, id, i) => {
      if (!cancelledIds.has(id)) acc.push(testNames[i] || "");
      return acc;
    }, []);
  };

  // Recalculate tubes for a registration based on the latest test/profile/checkup definitions.
  // Only touches PENDING tubes — collected/accepted/deferred tubes are preserved (same barcodes).
  // Fetches `tests` on demand (not in list select).
  const recalcTubesForRegistration = useCallback(async (regId: string) => {
    const { data: regRow, error: regErr } = await supabase
      .from("patient_registrations")
      .select("id, tests, cancelled_tests")
      .eq("id", regId)
      .maybeSingle();
    if (regErr) throw regErr;
    const reg = regRow as any;
    if (!reg) return;
    const tests = Array.isArray(reg.tests) ? reg.tests : [];
    if (tests.length === 0) return;

    const allIds = tests.map((t: any) => t.test_id).filter(Boolean);
    if (allIds.length === 0) return;
    const [profRes, pkgRes, cmbRes] = await Promise.all([
      supabase.from("billing_profiles").select("id").in("id", allIds),
      supabase.from("health_checkups").select("id").in("id", allIds),
      supabase.from("combos").select("id").in("id", allIds),
    ]);
    const profileIds = new Set((profRes.data || []).map((r: any) => r.id));
    const packageIds = new Set((pkgRes.data || []).map((r: any) => r.id));
    const comboIds = new Set((cmbRes.data || []).map((r: any) => r.id));

    const items: TubeGroupingItem[] = tests.map((t: any) => ({
      test_id: t.test_id,
      test_name: t.test_name || "",
      item_type: t.item_type || (packageIds.has(t.test_id) ? "package"
                                : comboIds.has(t.test_id) ? "combo"
                                : profileIds.has(t.test_id) ? "profile"
                                : "test"),
    }));

    const cancelledIds = getCancelledIds(reg);
    const desiredGroups = await buildSampleTubeGroups(items, cancelledIds);

    const { data: existingTubes } = await supabase
      .from("sample_tubes" as any)
      .select(TUBE_DETAIL_SELECT)
      .eq("registration_id", regId)
      .eq("status", "pending");
    const pendingExisting = (existingTubes || []) as any[];

    // Lock collected / accepted / deferred so collect-later barcodes stay stable
    const { data: lockedTubes } = await supabase
      .from("sample_tubes" as any)
      .select("test_ids, status")
      .eq("registration_id", regId)
      .neq("status", "pending");
    const lockedTestIds = new Set<string>();
    (lockedTubes || []).forEach((t: any) => (t.test_ids || []).forEach((id: string) => lockedTestIds.add(id)));

    const sig = (tubeType: string | null, suffix: string | null, testIds: string[]) =>
      `${tubeType || "DEFAULT"}||${suffix || ""}||${[...testIds].sort().join(",")}`;

    const filteredDesired = desiredGroups
      .map(g => {
        const keepIdx = g.testIds.map((id, i) => lockedTestIds.has(id) ? -1 : i).filter(i => i >= 0);
        return {
          ...g,
          testIds: keepIdx.map(i => g.testIds[i]),
          testNames: keepIdx.map(i => g.testNames[i]),
        };
      })
      .filter(g => g.testIds.length > 0);

    const desiredSigs = new Set(filteredDesired.map(g => sig(g.tubeType, g.suffix, g.testIds)));
    const existingSigs = new Set(pendingExisting.map(t => sig(t.tube_type, t.suffix, t.test_ids || [])));

    const matches = desiredSigs.size === existingSigs.size &&
      [...desiredSigs].every(s => existingSigs.has(s));
    if (matches) return;

    if (pendingExisting.length > 0) {
      await supabase.from("sample_tubes" as any).delete().in("id", pendingExisting.map(t => t.id));
    }
    for (const g of filteredDesired) {
      const { data: uidRes } = await supabase.rpc("generate_sample_uid");
      await supabase.from("sample_tubes" as any).insert({
        sample_uid: uidRes,
        registration_id: regId,
        tube_type: g.tubeType,
        tube_color: g.tubeColor,
        sample_type: g.sampleType,
        suffix: g.suffix,
        test_ids: g.testIds,
        test_names: g.testNames,
        status: "pending",
      });
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] }),
      qc.invalidateQueries({ queryKey: ["sample_collection_page_tubes"] }),
      qc.invalidateQueries({ queryKey: ["sample_collection_regs"] }),
    ]);
    toast.success("Sample tubes recalculated from latest test setup");
  }, [qc]);

  const buildGroups = useCallback((mode: CollectionTab): GroupedRegistration[] => {
    return registrations
      .map((reg: any) => ({
        registration: reg,
        tubes: pageTubes.filter((t) => t.registration_id === reg.id && !isTubeFullyCancelled(t, reg)),
      }))
      .filter((g) => {
        if (mode === "pending") return g.tubes.some((t) => t.status === "pending");
        if (mode === "deferred") return g.tubes.some((t) => t.status === "deferred");
        return g.tubes.some((t) => t.status === "collected");
      })
      .map((g) => {
        if (mode === "deferred") {
          return {
            ...g,
            tubes: g.tubes.filter((t) => t.status === "deferred"),
          };
        }
        if (mode === "collected") {
          return {
            ...g,
            tubes: g.tubes.filter((t) => t.status === "collected"),
          };
        }
        // pending view keeps pending+collected siblings for PARTIAL UI
        return g;
      });
  }, [registrations, pageTubes]);

  const pendingGroups = useMemo(() => buildGroups("pending"), [buildGroups]);
  const deferredGroups = useMemo(() => buildGroups("deferred"), [buildGroups]);
  const collectedGroups = useMemo(() => buildGroups("collected"), [buildGroups]);

  const activeGroups =
    activeTab === "pending" ? pendingGroups
    : activeTab === "deferred" ? deferredGroups
    : collectedGroups;

  const isLoading =
    loadingIndex
    || (!!appliedSearch && searchingIds && searchMatchedIds === undefined)
    || (pageIds.length > 0 && (loadingRegs || loadingTubes));
  const isFetching = searchingIds || fetchingRegs || fetchingTubes;

  // ─── NEW arrivals badge tracker (only pending list) ───
  const pendingRegIds = useMemo(() => idsByStatus.pending, [idsByStatus.pending]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("sample_collection", pendingRegIds);

  const toggleTube = (regId: string, tube: SampleTubeRow) => {
    setSelectedTubes(prev => {
      const regSet = new Set(prev[regId] || []);
      if (regSet.has(tube.id)) {
        regSet.delete(tube.id);
        setCollectNowTests(cn => {
          const next = { ...cn };
          delete next[tube.id];
          return next;
        });
      } else {
        regSet.add(tube.id);
        const ids = Array.isArray(tube.test_ids) ? tube.test_ids.filter(Boolean) : [];
        setCollectNowTests(cn => ({ ...cn, [tube.id]: new Set(ids) }));
      }
      return { ...prev, [regId]: regSet };
    });
  };

  const toggleCollectNowTest = (tube: SampleTubeRow, testId: string) => {
    setCollectNowTests(prev => {
      const allIds = Array.isArray(tube.test_ids) ? tube.test_ids.filter(Boolean) : [];
      const cur = new Set(prev[tube.id] ?? allIds);
      if (cur.has(testId)) cur.delete(testId);
      else cur.add(testId);
      return { ...prev, [tube.id]: cur };
    });
    // Ensure parent tube is selected when adjusting tests
    setSelectedTubes(prev => {
      const regSet = new Set(prev[tube.registration_id] || []);
      regSet.add(tube.id);
      return { ...prev, [tube.registration_id]: regSet };
    });
  };

  const toggleAllPendingTubes = (regId: string, tubes: SampleTubeRow[], selectAll: boolean) => {
    setSelectedTubes(prev => {
      const regSet = new Set<string>();
      if (selectAll) {
        tubes.filter(t => t.status === "pending" || t.status === "deferred").forEach(t => regSet.add(t.id));
      }
      return { ...prev, [regId]: regSet };
    });
    setCollectNowTests(prev => {
      const next = { ...prev };
      tubes.filter(t => t.status === "pending" || t.status === "deferred").forEach(t => {
        if (selectAll) {
          next[t.id] = new Set(Array.isArray(t.test_ids) ? t.test_ids.filter(Boolean) : []);
        } else {
          delete next[t.id];
        }
      });
      return next;
    });
  };

  const calcAge = (dob: string | null) => {
    if (!dob) return "";
    const birth = new Date(dob);
    const now = new Date();
    return `${now.getFullYear() - birth.getFullYear()}`;
  };

  const getTubeColorHex = (color: string | null) => {
    if (!color) return undefined;
    return TUBE_COLOR_MAP[color.toLowerCase().trim()] || color;
  };

  // Print barcodes helper - uses shared util
  const doPrintBarcodes = (reg: any, tubes: SampleTubeRow[]): Promise<void> => {
    return printBarcodes(reg, tubes);
  };

  // Mark tubes as collected — after optional per-test tube splits
  const collectMutation = useMutation({
    mutationFn: async ({ regId, tubeIds }: { regId: string; tubeIds: string[] }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "collected", collected_at: now, collected_by: getCurrentUserName() })
        .in("id", tubeIds)
        .in("status", ["pending", "deferred"]);
      if (error) throw error;
      await recalculateRegistrationStatus(regId);
    },
    onSuccess: async (_data, { regId }) => {
      await propagateRegistrationChange(qc, regId, ["sample_collection", "sample_acceptance"], { skipRecalc: true });
      setSelectedTubes({});
      setCollectNowTests({});
      toast.success("Samples marked as collected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Split shared tubes by test selection, then print & collect this visit's remnants */
  const visitCollectMutation = useMutation({
    mutationFn: async ({
      reg,
      tubes,
      selectedTubeIds,
      alsoDeferUnselectedTubes,
    }: {
      reg: any;
      tubes: SampleTubeRow[];
      selectedTubeIds: string[];
      alsoDeferUnselectedTubes: boolean;
    }) => {
      const collectNowByTubeId: Record<string, string[]> = {};
      for (const tid of selectedTubeIds) {
        const tube = tubes.find(t => t.id === tid);
        if (!tube) continue;
        const allIds = Array.isArray(tube.test_ids) ? tube.test_ids.filter(Boolean) : [];
        collectNowByTubeId[tid] = collectNowTests[tid]
          ? Array.from(collectNowTests[tid])
          : allIds;
      }

      const prepared = await prepareTubesForCollectionVisit({
        registrationId: reg.id,
        tubes,
        collectNowByTubeId,
        selectedTubeIds,
      });

      if (alsoDeferUnselectedTubes) {
        const selectedSet = new Set(selectedTubeIds);
        const remainder = tubes.filter(t => t.status === "pending" && !selectedSet.has(t.id));
        if (remainder.length > 0) {
          const { error } = await supabase
            .from("sample_tubes" as any)
            .update({ status: "deferred", collected_at: null, collected_by: null })
            .in("id", remainder.map(t => t.id))
            .eq("status", "pending");
          if (error) throw error;
        }
      }

      if (prepared.toCollect.length === 0) {
        await recalculateRegistrationStatus(reg.id);
        return { printed: 0, deferredCreated: prepared.deferredCreated, fullyDeferred: prepared.fullyDeferred };
      }

      await printBarcodes(reg, prepared.toCollect as any);
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "collected", collected_at: now, collected_by: getCurrentUserName() })
        .in("id", prepared.toCollect.map(t => t.id!))
        .in("status", ["pending", "deferred"]);
      if (error) throw error;
      await recalculateRegistrationStatus(reg.id);
      return {
        printed: prepared.toCollect.length,
        deferredCreated: prepared.deferredCreated,
        fullyDeferred: prepared.fullyDeferred,
      };
    },
    onSuccess: async (result, { reg }) => {
      await propagateRegistrationChange(qc, reg.id, ["sample_collection", "sample_acceptance"], { skipRecalc: true });
      setSelectedTubes({});
      setCollectNowTests({});
      const bits: string[] = [];
      if (result.printed) bits.push(`${result.printed} tube(s) collected`);
      if (result.deferredCreated) bits.push(`${result.deferredCreated} tube(s) split for later (new L barcode)`);
      if (result.fullyDeferred) bits.push(`${result.fullyDeferred} tube(s) deferred`);
      toast.success(bits.join(" · ") || "Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Defer tubes for a later visit — same barcode when whole tube deferred; splits when only some tests deferred
  const deferMutation = useMutation({
    mutationFn: async ({ regId, tubes }: { regId: string; tubes: SampleTubeRow[] }) => {
      const selectedTubeIds = tubes.map(t => t.id);
      const collectNowByTubeId: Record<string, string[]> = {};
      for (const tube of tubes) {
        const allIds = Array.isArray(tube.test_ids) ? tube.test_ids.filter(Boolean) : [];
        const nowSet = collectNowTests[tube.id];
        // Collect Later on selected tests = defer those NOT in collectNow (unchecked = later).
        // If all checked, defer the whole tube (nowIds empty for prepare by inverting).
        if (!nowSet || nowSet.size === allIds.length) {
          collectNowByTubeId[tube.id] = []; // defer all
        } else {
          // Defer unchecked: keep checked as collect-now remnant (pending), split unchecked to deferred
          collectNowByTubeId[tube.id] = Array.from(nowSet);
        }
      }
      // For "Collect Later" button: user wants selected tubes' unchecked tests later.
      // If all tests still checked, treat as defer entire tube.
      await prepareTubesForCollectionVisit({
        registrationId: regId,
        tubes,
        collectNowByTubeId,
        selectedTubeIds,
      });
      // Any remnant that still has tests and is pending with empty collect-now was fully deferred inside prepare.
      // Remnants with collect-now tests stay pending for later print — but Collect Later button intent
      // when ALL tests checked is full defer. When PARTIAL unchecked, keep now-tests pending.
      // If all checked → collectNowByTubeId[id]=[] → fully deferred. Good.
      // If partial → split, now remnant stays pending. User may still want to collect those — OK.
      await recalculateRegistrationStatus(regId);
    },
    onSuccess: async (_data, { regId }) => {
      await propagateRegistrationChange(qc, regId, ["sample_collection", "sample_acceptance"], { skipRecalc: true });
      setSelectedTubes({});
      setCollectNowTests({});
      toast.success("Later tests deferred — shared tubes split with new L barcodes when needed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undeferMutation = useMutation({
    mutationFn: async ({ regId, tubeIds }: { regId: string; tubeIds: string[] }) => {
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "pending" })
        .in("id", tubeIds)
        .eq("status", "deferred");
      if (error) throw error;
      await recalculateRegistrationStatus(regId);
    },
    onSuccess: async (_data, { regId }) => {
      await propagateRegistrationChange(qc, regId, ["sample_collection"], { skipRecalc: true });
      setSelectedTubes({});
      setCollectNowTests({});
      toast.success("Tubes moved back to Pending collection");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cancel collection — revert a single tube back to pending. Guarded so accepted tubes cannot be reverted.
  const cancelCollectMutation = useMutation({
    mutationFn: async ({ regId, tubeId }: { regId: string; tubeId: string }) => {
      const { data: tubeRow, error: fetchErr } = await supabase
        .from("sample_tubes" as any)
        .select("status")
        .eq("id", tubeId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!tubeRow || (tubeRow as any).status !== "collected") {
        throw new Error("Tube is no longer in 'collected' state — cannot revert");
      }
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "pending", collected_at: null, collected_by: null })
        .eq("id", tubeId)
        .eq("status", "collected");
      if (error) throw error;
      await recalculateRegistrationStatus(regId);
    },
    onSuccess: async (_data, { regId }) => {
      await propagateRegistrationChange(qc, regId, ["sample_collection", "sample_acceptance"], { skipRecalc: true });
      setCancelCollectDialog({ open: false, reg: null, tube: null });
      toast.success("Collection cancelled — tube reverted to pending");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestPrintConfirm = (reg: any, tubes: SampleTubeRow[], action: () => void) => {
    if (tubes.length === 0) { toast.error("No tubes to print"); return; }
    setPrintConfirmDialog({ open: true, reg, tubes, action });
  };

  const doPrintAndCollect = (
    reg: any,
    tubes: SampleTubeRow[],
    alsoDeferRemainder = false,
    explicitSelected?: SampleTubeRow[],
  ) => {
    const regSel = selectedTubes[reg.id] || new Set();
    const selected = explicitSelected
      || tubes.filter(t => regSel.has(t.id) && (t.status === "pending" || t.status === "deferred"));
    if (selected.length === 0) { toast.error("Please select at least one barcode"); return; }
    visitCollectMutation.mutate({
      reg,
      tubes,
      selectedTubeIds: selected.map(t => t.id),
      alsoDeferUnselectedTubes: alsoDeferRemainder,
    });
  };

  const handlePrintAndCollect = (reg: any, tubes: SampleTubeRow[]) => {
    const regSel = selectedTubes[reg.id] || new Set();
    const selected = tubes.filter(t => regSel.has(t.id) && (t.status === "pending" || t.status === "deferred"));
    if (selected.length === 0) { toast.error("Please select at least one barcode"); return; }
    // Any unchecked tests on selected tubes, or wholly unselected pending tubes?
    const hasPartialTests = selected.some(t => {
      const allIds = Array.isArray(t.test_ids) ? t.test_ids.filter(Boolean) : [];
      const now = collectNowTests[t.id];
      return !!now && now.size < allIds.length;
    });
    const remainder = tubes.filter(t => t.status === "pending" && !regSel.has(t.id));
    if (remainder.length > 0 && !hasPartialTests) {
      setDeferRemainderDialog({ open: true, reg, selected, remainder });
      return;
    }
    // Partial test selection → always split unchecked tests to deferred L barcodes
    requestPrintConfirm(reg, selected, () => doPrintAndCollect(reg, tubes, remainder.length > 0));
  };

  const doSinglePrintAndCollect = (reg: any, tube: SampleTubeRow) => {
    visitCollectMutation.mutate({
      reg,
      tubes: [tube],
      selectedTubeIds: [tube.id],
      alsoDeferUnselectedTubes: false,
    });
  };

  const handleSinglePrintAndCollect = (reg: any, tube: SampleTubeRow) => {
    requestPrintConfirm(reg, [tube], () => doSinglePrintAndCollect(reg, tube));
  };

  // Reprint
  const openReprintDialog = (group: GroupedRegistration) => {
    const allTubesForReg = pageTubes.filter(t => t.registration_id === group.registration.id);
    setReprintSelectedTubes(new Set(allTubesForReg.map(t => t.id)));
    setReprintReason("");
    setReprintDialog({ open: true, reg: group.registration, tubes: allTubesForReg });
  };

  const handleReprint = () => {
    if (!reprintReason.trim()) { toast.error("Please provide a reason for reprinting"); return; }
    const toPrint = reprintDialog.tubes.filter(t => reprintSelectedTubes.has(t.id));
    if (toPrint.length === 0) { toast.error("Please select at least one barcode"); return; }
    doPrintBarcodes(reprintDialog.reg, toPrint);
    toast.success(`Reprinted ${toPrint.length} barcode(s). Reason: ${reprintReason.trim()}`);
    setReprintDialog({ open: false, reg: null, tubes: [] });
  };

  const getVisitLabel = (v: string) => {
    switch (v) {
      case "lab_visit": return "Lab";
      case "home_visit": return "Home";
      case "pickup_point": return "Pickup";
      default: return v;
    }
  };

  const renderTubeExpansion = (group: GroupedRegistration, mode: "pending" | "deferred" | "collected") => {
    const reg = group.registration;
    const tubes = group.tubes;
    const pendingTubes = tubes.filter(t => t.status === "pending");
    const deferredTubes = tubes.filter(t => t.status === "deferred");
    const collectedTubes = tubes.filter(t => t.status === "collected");
    const selectable = mode === "deferred" ? deferredTubes : pendingTubes;
    const regSel = selectedTubes[reg.id] || new Set();
    const selectedCount = selectable.filter(t => regSel.has(t.id)).length;
    const allSelectableSelected = selectable.length > 0 && selectable.every(t => regSel.has(t.id));
    const cancelledIds = getCancelledIds(reg);
    const repeatTestIds = new Set(
      (Array.isArray(reg.repeat_tests) ? reg.repeat_tests : [])
        .map((x: any) => x?.test_id)
        .filter(Boolean),
    );

    const displayTubes =
      mode === "collected" ? collectedTubes
      : mode === "deferred" ? deferredTubes
      : tubes.filter(t => t.status === "pending" || t.status === "collected");

    return (
      <div className="bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-sm font-semibold">
            Sample Tubes
            {mode === "pending" && collectedTubes.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({collectedTubes.length} collected, {pendingTubes.length} remaining
                {deferredTubes.length > 0 ? `, ${deferredTubes.length} later` : ""})
              </span>
            )}
            {mode === "deferred" && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                Return visit — print same or L-split barcodes; not in Acceptance / Results / LIMS until collected
              </span>
            )}
          </h4>
          <div className="flex gap-2 flex-wrap">
            {mode === "pending" && pendingTubes.length > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => toggleAllPendingTubes(reg.id, tubes, !allSelectableSelected)}>
                  {allSelectableSelected ? "Deselect All" : "Select All"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    const picked = pendingTubes.filter(t => regSel.has(t.id));
                    if (picked.length === 0) return;
                    deferMutation.mutate({ regId: reg.id, tubes: picked });
                  }}
                >
                  <Clock className="h-3.5 w-3.5" /> Collect Later ({selectedCount})
                </Button>
                <Button size="sm" variant="default" className="gap-1" disabled={selectedCount === 0}
                  onClick={() => handlePrintAndCollect(reg, tubes)}>
                  <Printer className="h-3.5 w-3.5" /> Print & Collect ({selectedCount})
                </Button>
              </>
            )}
            {mode === "deferred" && deferredTubes.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedTubes(prev => {
                      const regSet = new Set<string>();
                      if (!allSelectableSelected) deferredTubes.forEach(t => regSet.add(t.id));
                      return { ...prev, [reg.id]: regSet };
                    });
                    setCollectNowTests(prev => {
                      const next = { ...prev };
                      deferredTubes.forEach(t => {
                        if (!allSelectableSelected) {
                          next[t.id] = new Set(Array.isArray(t.test_ids) ? t.test_ids.filter(Boolean) : []);
                        } else {
                          delete next[t.id];
                        }
                      });
                      return next;
                    });
                  }}
                >
                  {allSelectableSelected ? "Deselect All" : "Select All"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    const ids = deferredTubes.filter(t => regSel.has(t.id)).map(t => t.id);
                    if (ids.length) undeferMutation.mutate({ regId: reg.id, tubeIds: ids });
                  }}
                >
                  Move to Pending
                </Button>
                <Button size="sm" variant="default" className="gap-1" disabled={selectedCount === 0}
                  onClick={() => handlePrintAndCollect(reg, deferredTubes)}>
                  <Printer className="h-3.5 w-3.5" /> Print & Collect ({selectedCount})
                </Button>
              </>
            )}
            {mode === "collected" && collectedTubes.length > 0 && (
              <Button size="sm" variant="outline" className="gap-1"
                onClick={() => requestPrintConfirm(reg, collectedTubes, () => { doPrintBarcodes(reg, collectedTubes); toast.success(`Reprinted all ${collectedTubes.length} barcode(s)`); })}>
                <Printer className="h-3.5 w-3.5" /> Print All ({collectedTubes.length})
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          {displayTubes.map((tube) => {
            const colorHex = getTubeColorHex(tube.tube_color);
            const isCollected = tube.status === "collected";
            const isDeferred = tube.status === "deferred";
            const isSelected = regSel.has(tube.id);
            const canSelect = (mode === "pending" && tube.status === "pending") || (mode === "deferred" && isDeferred);
            const isRepeatTube =
              Array.isArray(tube.test_ids) && tube.test_ids.some((id: string) => repeatTestIds.has(id));
            return (
              <Card key={tube.id} className={`${isCollected && mode === "pending" ? "opacity-60" : ""} ${canSelect && isSelected ? "ring-2 ring-primary" : ""} ${isRepeatTube && !isCollected ? "border-destructive/50" : ""} ${isDeferred ? "border-amber-300" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {canSelect && (
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleTube(reg.id, tube)} />
                  )}
                  {colorHex && (
                    <span className="inline-block w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0"
                      style={{ backgroundColor: colorHex }} title={tube.tube_color || ""} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">{getBarcodeLabel(reg, tube)}</span>
                      <Badge variant="outline" className="text-xs">
                        {(tube.tube_type || "DEFAULT") === "DEFAULT" ? "No Tube" : tube.tube_type}
                      </Badge>
                      {isRepeatTube && (
                        <Badge variant="destructive" className="text-xs">REPEAT</Badge>
                      )}
                      {tube.sample_type && <span className="text-xs text-muted-foreground">{tube.sample_type}</span>}
                      {isDeferred && (
                        <Badge className="text-xs bg-amber-100 text-amber-900 border-amber-300">
                          <Clock className="h-3 w-3 mr-1" /> Collect Later
                        </Badge>
                      )}
                      {isCollected && (
                        <>
                          <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Collected
                          </Badge>
                          {tube.collected_at && (
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(tube.collected_at), "dd-MM-yyyy hh:mm a")}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {/* Per-test collect-now toggles — enables splitting shared tubes (e.g. CBC now, ESR later) */}
                    {canSelect && Array.isArray(tube.test_ids) && tube.test_ids.length > 0 ? (
                      <div className="mt-2 space-y-1 pl-1 border-l-2 border-muted">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Tests on this tube — uncheck to collect later (splits barcode with L suffix)
                        </p>
                        {tube.test_ids.map((tid, i) => {
                          if (!tid || cancelledIds.has(tid)) return null;
                          const allIds = tube.test_ids.filter(Boolean);
                          const nowSet = collectNowTests[tube.id] ?? new Set(allIds);
                          const checked = nowSet.has(tid);
                          const name = (tube.test_names && tube.test_names[i]) || tid;
                          return (
                            <label key={tid} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleCollectNowTest(tube, tid)}
                              />
                              <span className={checked ? "" : "text-muted-foreground line-through"}>
                                {name}
                              </span>
                              {!checked && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 text-amber-800 border-amber-300">later</Badge>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {getActiveTestNames(tube, reg).join(", ")}
                      </p>
                    )}
                  </div>
                  {canSelect && (
                    <Button size="sm" variant="ghost" className="shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleSinglePrintAndCollect(reg, tube); }}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {mode === "collected" && isCollected && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" title="Reprint this barcode"
                        onClick={(e) => { e.stopPropagation(); requestPrintConfirm(reg, [tube], () => { doPrintBarcodes(reg, [tube]); toast.success(`Reprinted barcode for ${getBarcodeLabel(reg, tube)}`); }); }}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Cancel collection (revert to pending)"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => { e.stopPropagation(); setCancelCollectDialog({ open: true, reg, tube }); }}>
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTable = (groups: GroupedRegistration[], mode: "pending" | "deferred" | "collected", loading: boolean) => {
    if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
    if (groups.length === 0) return (
      <p className="text-sm text-muted-foreground">
        {mode === "pending"
          ? "No registered patients pending sample collection"
          : mode === "deferred"
            ? "No tubes marked Collect Later"
            : "No collected samples found"}
      </p>
    );

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Patient Name</TableHead>
            <TableHead>Age/Gender</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Visit</TableHead>
            <TableHead>Tubes</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ registration: reg, tubes }) => {
            const isExpanded = expandedRow === reg.id;
            const pendingTubes = tubes.filter(t => t.status === "pending");
            const deferredCount = pageTubes.filter(t => t.registration_id === reg.id && t.status === "deferred").length;
            const collectedTubes = tubes.filter(t => t.status === "collected");

            return (
              <>
                <TableRow key={reg.id}
                  className={`cursor-pointer hover:bg-muted/50 ${reg.is_stat ? "bg-destructive/5 border-l-2 border-l-destructive" : ""}`}
                  onClick={() => {
                    const next = isExpanded ? null : reg.id;
                    markArrivalSeen(reg.id);
                    setExpandedRow(next);
                    if (next && mode === "pending") void recalcTubesForRegistration(reg.id);
                  }}>
                  <TableCell>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold">{reg.invoice_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {patientDisplayName(reg)}
                      {mode === "pending" && <NewBadge show={isNewArrival(reg.id)} className="ml-1.5 align-middle" />}
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                        </span>
                      )}
                      {(reg.status === "repeat_collection" || (Array.isArray(reg.repeat_tests) && reg.repeat_tests.length > 0)) && (
                        <Badge variant="destructive" className="ml-2 text-xs" title={(reg.repeat_tests || []).map((t: any) => t.test_name || t.test_id).join(", ")}>
                          REPEAT{Array.isArray(reg.repeat_tests) && reg.repeat_tests.length ? ` (${reg.repeat_tests.length})` : ""}
                        </Badge>
                      )}
                      {mode === "pending" && collectedTubes.length > 0 && pendingTubes.length > 0 && (
                        <Badge className="ml-2 text-xs bg-amber-500 text-white border-0">PARTIAL</Badge>
                      )}
                      {mode === "pending" && deferredCount > 0 && (
                        <Badge className="ml-2 text-xs bg-amber-100 text-amber-900 border-amber-300">{deferredCount} later</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{formatAgeGender(reg.dob, reg.gender)}</TableCell>
                  <TableCell className="text-sm">{reg.mobile_number}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{getVisitLabel(reg.visit_type)}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {tubes.length} tube(s)
                    {mode === "pending" && collectedTubes.length > 0 && (
                      <span className="text-xs text-green-600 ml-1">({collectedTubes.length} done)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(reg.created_at), "dd/MM/yy HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    {mode === "pending" ? (
                      <Button size="sm" variant="default" className="gap-1"
                        onClick={(e) => { e.stopPropagation(); toggleAllPendingTubes(reg.id, tubes, true); setExpandedRow(reg.id); }}>
                        <Printer className="h-3.5 w-3.5" /> Print All
                      </Button>
                    ) : mode === "deferred" ? (
                      <Button size="sm" variant="default" className="gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTubes(prev => ({ ...prev, [reg.id]: new Set(tubes.map(t => t.id)) }));
                          setExpandedRow(reg.id);
                        }}>
                        <Printer className="h-3.5 w-3.5" /> Collect
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={(e) => { e.stopPropagation(); openReprintDialog({ registration: reg, tubes }); }}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reprint
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${reg.id}-expand`}>
                    <TableCell colSpan={9} className="p-0">
                      {renderTubeExpansion({ registration: reg, tubes }, mode)}
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    );
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 max-w-xl min-w-[220px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Search by name, mobile, invoice..."
              className="pl-8"
            />
          </div>
          <Button size="sm" onClick={runSearch}>Search</Button>
          {appliedSearch && (
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              <X className="h-4 w-4 mr-1" />Clear
            </Button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
          <Checkbox
            checked={showOlderPending}
            onCheckedChange={(v) => {
              setShowOlderPending(v === true);
              setVisibleLimit(LIST_BATCH);
              setExpandedRow(null);
            }}
          />
          Show older pending
          <span className="text-xs hidden sm:inline">(beyond 14 days)</span>
        </label>
        <RefreshButton
          queryKeys={[
            "sample_tubes_collection",
            "sample_collection_regs",
            "sample_collection_page_tubes",
            "sample_collection_search",
          ]}
          className="ml-auto"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as CollectionTab);
          setVisibleLimit(LIST_BATCH);
          setExpandedRow(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending <Badge variant="secondary" className="text-xs ml-1">{idsByStatus.pending.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="deferred" className="gap-1.5">
            Collect Later <Badge variant="secondary" className="text-xs ml-1">{idsByStatus.deferred.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="collected" className="gap-1.5">
            Collected <Badge variant="secondary" className="text-xs ml-1">{idsByStatus.collected.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-3">
          {renderTable(pendingGroups, "pending", isLoading)}
        </TabsContent>
        <TabsContent value="deferred" className="mt-3">
          {renderTable(deferredGroups, "deferred", isLoading)}
        </TabsContent>
        <TabsContent value="collected" className="mt-3">
          {renderTable(collectedGroups, "collected", isLoading)}
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          Showing {activeGroups.length} of {orderedIds.length}
          {isFetching && !isLoading ? " · Updating…" : ""}
        </span>
        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => setVisibleLimit((n) => n + LIST_BATCH)}
          >
            {isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Load more
          </Button>
        )}
      </div>

      {/* Reprint Dialog */}
      <Dialog open={reprintDialog.open} onOpenChange={(open) => { if (!open) setReprintDialog({ open: false, reg: null, tubes: [] }); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reprint Barcodes</DialogTitle>
            <DialogDescription>
              Patient: <strong>{patientDisplayName(reprintDialog.reg)}</strong> — {reprintDialog.reg?.invoice_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              {reprintDialog.tubes.map((tube) => {
                const colorHex = getTubeColorHex(tube.tube_color);
                return (
                  <div key={tube.id} className="flex items-center gap-3 p-2 rounded border">
                    <Checkbox checked={reprintSelectedTubes.has(tube.id)}
                      onCheckedChange={() => setReprintSelectedTubes(prev => {
                        const next = new Set(prev);
                        if (next.has(tube.id)) next.delete(tube.id); else next.add(tube.id);
                        return next;
                      })} />
                    {colorHex && (
                      <span className="inline-block w-4 h-4 rounded-full border shrink-0"
                        style={{ backgroundColor: colorHex }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono font-bold text-sm">{getBarcodeLabel(reprintDialog.reg, tube)}</span>
                      <Badge variant="outline" className="text-xs ml-2">
                        {(tube.tube_type || "DEFAULT") === "DEFAULT" ? "No Tube" : tube.tube_type}
                      </Badge>
                      <p className="text-xs text-muted-foreground truncate">{getActiveTestNames(tube, reprintDialog.reg).join(", ")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason for Reprint <span className="text-destructive">*</span></label>
              <Textarea value={reprintReason} onChange={(e) => setReprintReason(e.target.value)}
                placeholder="e.g. Barcode damaged, label fell off, scanner not reading..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprintDialog({ open: false, reg: null, tubes: [] })}>Cancel</Button>
            <Button className="gap-1" onClick={handleReprint}
              disabled={!reprintReason.trim() || reprintSelectedTubes.size === 0}>
              <Printer className="h-3.5 w-3.5" /> Reprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Collection confirmation */}
      <AlertDialog open={cancelCollectDialog.open} onOpenChange={(open) => { if (!open) setCancelCollectDialog({ open: false, reg: null, tube: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert tube <strong className="font-mono">{cancelCollectDialog.tube ? getBarcodeLabel(cancelCollectDialog.reg, cancelCollectDialog.tube) : ""}</strong> for patient <strong>{patientDisplayName(cancelCollectDialog.reg)}</strong> back to <strong>Pending</strong>. Use this only if the sample was marked collected by mistake. If the tube has already been accepted in the lab, this action will fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep as Collected</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelCollectDialog.reg && cancelCollectDialog.tube) {
                  cancelCollectMutation.mutate({ regId: cancelCollectDialog.reg.id, tubeId: cancelCollectDialog.tube.id });
                }
              }}
              disabled={cancelCollectMutation.isPending}>
              {cancelCollectMutation.isPending ? "Reverting..." : "Yes, Revert to Pending"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Confirmation Dialog */}
      <AlertDialog open={printConfirmDialog.open} onOpenChange={(open) => { if (!open) setPrintConfirmDialog({ open: false, reg: null, tubes: [], action: null }); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Print</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="space-y-1">
                  <div><span className="text-muted-foreground">Patient Name:</span> <strong>{patientDisplayName(printConfirmDialog.reg)}</strong></div>
                  <div>
                    <span className="text-muted-foreground">Age / Gender:</span>{" "}
                    <strong>{calcAge(printConfirmDialog.reg?.dob) || "—"} / {printConfirmDialog.reg?.gender || "—"}</strong>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Tubes to print: <strong className="text-foreground">{printConfirmDialog.tubes.length}</strong></div>
                  <ul className="max-h-48 overflow-auto space-y-1 border rounded p-2 bg-muted/30">
                    {printConfirmDialog.tubes.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs">{printConfirmDialog.reg ? getBarcodeLabel(printConfirmDialog.reg, t) : ""}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(t.tube_type || "DEFAULT") === "DEFAULT" ? "No Tube" : t.tube_type})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const fn = printConfirmDialog.action;
                setPrintConfirmDialog({ open: false, reg: null, tubes: [], action: null });
                if (fn) fn();
              }}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Print
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Partial collect: defer unselected tubes for a later visit */}
      <AlertDialog
        open={deferRemainderDialog.open}
        onOpenChange={(open) => {
          if (!open) setDeferRemainderDialog({ open: false, reg: null, selected: [], remainder: [] });
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Collect remaining tests later?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  You selected <strong>{deferRemainderDialog.selected.length}</strong> tube(s) to print & collect now.
                  <strong> {deferRemainderDialog.remainder.length}</strong> tube(s) were not selected.
                </p>
                <p>
                  Mark unselected tubes as <strong>Collect Later</strong>? They keep the <strong>same barcodes</strong>
                  (or get a new <strong>L</strong> barcode if only some tests on a shared tube are deferred),
                  stay out of Sample Acceptance / Results / LIMS orders until collected, and appear under Collect Later.
                </p>
                <p className="text-xs text-muted-foreground">
                  Tip: under each tube you can uncheck individual tests (e.g. CBC now, ESR later on the same EDTA) — the system splits the tube automatically.
                </p>
                <ul className="max-h-32 overflow-auto space-y-1 border rounded p-2 bg-muted/30 text-xs">
                  {deferRemainderDialog.remainder.map((t) => (
                    <li key={t.id} className="font-mono">
                      {deferRemainderDialog.reg ? getBarcodeLabel(deferRemainderDialog.reg, t) : ""} — {getActiveTestNames(t, deferRemainderDialog.reg).join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const { reg, selected, remainder } = deferRemainderDialog;
                setDeferRemainderDialog({ open: false, reg: null, selected: [], remainder: [] });
                if (!reg) return;
                requestPrintConfirm(reg, selected, () => doPrintAndCollect(reg, [...selected, ...remainder], false, selected));
              }}
            >
              Collect selected only
            </Button>
            <AlertDialogAction
              onClick={() => {
                const { reg, selected, remainder } = deferRemainderDialog;
                setDeferRemainderDialog({ open: false, reg: null, selected: [], remainder: [] });
                if (!reg) return;
                requestPrintConfirm(reg, selected, () => doPrintAndCollect(reg, [...selected, ...remainder], true, selected));
              }}
            >
              <Clock className="h-3.5 w-3.5 mr-1" /> Collect now + defer rest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div ref={printRef} className="hidden" />
    </div>
  );
};

export default SampleCollection;
