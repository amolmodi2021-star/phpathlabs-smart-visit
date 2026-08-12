import RefreshButton from "@/components/lims/RefreshButton";
import PageSizeSelect from "@/components/lims/PageSizeSelect";
import { useState, useEffect, useMemo } from "react";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import SyncingOverlay from "./SyncingOverlay";
import { formatAgeGender } from "@/lib/ageGender";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { getCurrentUserName } from "@/lib/auth";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Loader2, Send, Eye, Truck, Circle, Phone, Calendar as CalendarIcon, FileText, User, Clock, ChevronRight, ArrowLeft, MessageSquare, Download } from "lucide-react";
import { toast } from "sonner";
import { format, startOfDay, endOfDay, subDays, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import { PATIENT_RESULTS_SELECT_DISPATCH } from "@/lib/patientResultsSelect";
import { fetchDispatchStatusIds, fetchDispatchPendingDispatchIds } from "@/lib/limsPendingCandidates";
import { shortIdsKey } from "@/lib/queryKeys";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import NewBadge from "./NewBadge";
import { openReportForManualWhatsApp, queueApprovedReportWhatsApp } from "@/lib/dispatchReportWhatsApp";
import { dismissFailedWhatsAppConsoleJobs, dismissAllFailedWhatsAppConsoleJobs } from "@/lib/whatsappConsoleBridge";
import {
  dispatchDotFromRegStatus,
  readLimsPageSize,
  type LimsPageSize,
} from "@/lib/limsListPrefs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type TestStatus = "registered" | "sample_collected" | "sample_accepted" | "results_entered" | "verified" | "approved" | "dispatched" | "cancelled";

interface DispatchTest {
  testId: string;
  testName: string;
  status: TestStatus;
  results: any[];
  snipUrls: string[];
  collectedAt: string | null;
  acceptedAt: string | null;
  enteredAt: string | null;
  verifiedAt: string | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  registeredBy: string | null;
  collectedBy: string | null;
  acceptedBy: string | null;
  enteredBy: string | null;
  verifiedBy: string | null;
  approvedBy: string | null;
  dispatchedBy: string | null;
}

interface DispatchEntry {
  registration: any;
  tests: DispatchTest[];
  /** all_dispatched = every active test dispatched (blue); all_done = every report approved (green) */
  completionStatus: "all_done" | "all_dispatched" | "partial" | "all_pending" | "cancelled";
  approvedCount: number;
  pendingCount: number;
  dispatchedCount: number;
  cancelledCount: number;
}

/** Full DispatchEntry for one registration from detail arrays (results/tubes/snips). */
function buildFullDispatchEntry(
  reg: any,
  allResults: any[],
  allTubes: any[],
  allSnips: any[],
  testsMap: Record<string, any>,
): DispatchEntry {
  const tests = (reg.tests || []) as any[];
  const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id || t.id).filter(Boolean));
  const billCancelled = !!reg.bill_cancelled;
  const leafIds = new Set<string>();
  for (const tb of allTubes) {
    if (tb.registration_id !== reg.id) continue;
    const ids = Array.isArray(tb.test_ids) ? tb.test_ids : [];
    ids.forEach((id: string) => leafIds.add(id));
  }
  const expandedTests = expandRegistrationTests(tests, leafIds, testsMap);

  const dispatchTests: DispatchTest[] = [];
  for (const t of expandedTests) {
    const testInfo = testsMap[t.test_id] || {};
    const isCancelled = billCancelled || cancelledIds.has(t.test_id);
    const testResults = allResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
    const snip = allSnips.find((s: any) => s.registration_id === reg.id && s.test_id === t.test_id);
    const tube = allTubes.find((tb: any) => tb.registration_id === reg.id && Array.isArray(tb.test_ids) && tb.test_ids.includes(t.test_id));

    const hasDispatchedResults = testResults.some((r: any) => r.status === "dispatched");
    const hasDispatchedSnip = snip && snip.outsource_status === "dispatched";
    const hasApprovedResults = testResults.some((r: any) => r.status === "approved");
    const hasApprovedSnip = snip && snip.outsource_status === "approved";
    const hasVerifiedResults = testResults.some((r: any) => r.status === "verified");
    const hasVerifiedSnip = snip && snip.outsource_status === "verified";
    const hasEnteredResults = testResults.some((r: any) => r.status === "entered" || r.status === "results_entered");
    const hasEnteredSnip = snip && (snip.outsource_status === "results_entered" || snip.outsource_status === "results_saved" || snip.outsource_status === "sent");

    let status: TestStatus = "registered";
    if (isCancelled) {
      status = "cancelled";
    } else if (hasDispatchedResults || hasDispatchedSnip) status = "dispatched";
    else if (hasApprovedResults || hasApprovedSnip) status = "approved";
    else if (hasVerifiedResults || hasVerifiedSnip) status = "verified";
    else if (hasEnteredResults || hasEnteredSnip) status = "results_entered";
    else if (tube?.status === "accepted" || tube?.accepted_at) status = "sample_accepted";
    else if (tube?.status === "collected" || tube?.collected_at) status = "sample_collected";
    else status = "registered";

    const snipUrls = snip && snip.result_mode === "snip" && Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls : [];
    const approvedResults = testResults.filter((r: any) => r.status === "approved");

    const collectedAt = tube?.collected_at || null;
    const acceptedAt = tube?.accepted_at || null;
    const getEarliest = (field: string) => {
      const vals = testResults.map((r: any) => r[field]).filter(Boolean);
      return vals.length > 0 ? vals.sort()[0] : null;
    };
    const getFirstBy = (field: string) => {
      const vals = testResults.map((r: any) => r[field]).filter(Boolean);
      return vals.length > 0 ? vals[0] : null;
    };

    let enteredAt = getEarliest("entered_at");
    let verifiedAt = getEarliest("verified_at");
    let approvedAtTs = getEarliest("approved_at");
    let dispatchedAtTs = getEarliest("dispatched_at");
    let enteredBy = getFirstBy("entered_by");
    let verifiedBy = getFirstBy("verified_by");
    let approvedBy = getFirstBy("approved_by");
    let dispatchedBy = getFirstBy("dispatched_by");
    if (snip && !isCancelled) {
      const snipStatus = snip.outsource_status;
      const snipTime = snip.updated_at || snip.sent_at || null;
      if (["results_entered", "results_saved", "sent", "verified", "approved", "dispatched"].includes(snipStatus)) {
        enteredAt = enteredAt || snip.entered_at || snipTime;
        enteredBy = enteredBy || snip.entered_by || null;
      }
      if (["verified", "approved", "dispatched"].includes(snipStatus)) {
        verifiedAt = verifiedAt || snip.verified_at || snipTime;
        verifiedBy = verifiedBy || snip.verified_by || null;
      }
      if (["approved", "dispatched"].includes(snipStatus)) {
        approvedAtTs = approvedAtTs || snip.approved_at || snipTime;
        approvedBy = approvedBy || snip.approved_by || null;
      }
      if (snipStatus === "dispatched") {
        dispatchedAtTs = dispatchedAtTs || snip.dispatched_at || snipTime;
        dispatchedBy = dispatchedBy || snip.dispatched_by || null;
      }
    }

    dispatchTests.push({
      testId: t.test_id,
      testName: t.test_name || testInfo.test_name || "Unknown",
      status,
      results: approvedResults,
      snipUrls: status === "approved" ? snipUrls : [],
      collectedAt,
      acceptedAt,
      enteredAt,
      verifiedAt,
      approvedAt: approvedAtTs,
      dispatchedAt: dispatchedAtTs,
      registeredBy: reg.registered_by || null,
      collectedBy: tube?.collected_by || null,
      acceptedBy: tube?.accepted_by || null,
      enteredBy,
      verifiedBy,
      approvedBy,
      dispatchedBy,
    });
  }

  const cancelledCount = dispatchTests.filter((t) => t.status === "cancelled").length;
  const approvedCount = dispatchTests.filter((t) => t.status === "approved").length;
  const dispatchedCount = dispatchTests.filter((t) => t.status === "dispatched").length;
  const pendingCount = dispatchTests.filter((t) => t.status !== "approved" && t.status !== "dispatched" && t.status !== "cancelled").length;
  const activeCount = dispatchTests.length - cancelledCount;

  let completionStatus: DispatchEntry["completionStatus"] = "all_pending";
  if (billCancelled || (dispatchTests.length > 0 && cancelledCount === dispatchTests.length)) {
    completionStatus = "cancelled";
  } else if (activeCount > 0 && dispatchedCount === activeCount) {
    completionStatus = "all_dispatched";
  } else if (activeCount > 0 && approvedCount + dispatchedCount === activeCount) {
    completionStatus = "all_done";
  } else if (dispatchedCount > 0 || approvedCount > 0) {
    completionStatus = "partial";
  }

  return {
    registration: reg,
    tests: dispatchTests,
    completionStatus,
    approvedCount,
    pendingCount,
    dispatchedCount,
    cancelledCount,
  };
}

const Dispatch = () => {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  useLimsPipelineRealtime("dispatch");
  const [search, setSearch] = useState("");
  /** Current = full status board (includes blue). Pending = approved undispached only (no blue). */
  const [listMode, setListMode] = useState<"current" | "pending_dispatch">("current");
  const [includeOlderPending, setIncludeOlderPending] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date>(startOfDay(subDays(new Date(), 7)));
  const [dateTo, setDateTo] = useState<Date>(endOfDay(new Date()));
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const [reportSelectEntry, setReportSelectEntry] = useState<DispatchEntry | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [pageSize, setPageSize] = useState<LimsPageSize>(() => readLimsPageSize(10));
  const [dispatchPage, setDispatchPage] = useState(0);
  /** After Today: Current board lists every matching patient (no page chunking). */
  const [showAllForDay, setShowAllForDay] = useState(false);
  const [dueBlockEntry, setDueBlockEntry] = useState<DispatchEntry | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setDispatchPage(0);
    setSelectedPatientId(null);
  }, [debouncedSearch, dateFrom, dateTo, includeOlderPending, listMode, pageSize, showAllForDay]);

  const { data: filteredDispatchIds = [] as string[], isLoading: loadingIds } = useQuery({
    queryKey: [
      "dispatch_filtered_ids",
      listMode,
      debouncedSearch,
      dateFrom.toISOString(),
      dateTo.toISOString(),
      listMode === "pending_dispatch" ? includeOlderPending : false,
    ],
    queryFn: async (): Promise<string[]> => {
      if (listMode === "pending_dispatch") {
        return await fetchDispatchPendingDispatchIds(debouncedSearch, {
          dateFromIso: dateFrom.toISOString(),
          dateToIso: dateTo.toISOString(),
          includeOlder: includeOlderPending,
        });
      }
      return await fetchDispatchStatusIds(debouncedSearch, {
        dateFromIso: dateFrom.toISOString(),
        dateToIso: dateTo.toISOString(),
      });
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  const dispatchCount = filteredDispatchIds.length;
  const todayRange =
    listMode === "current" &&
    showAllForDay &&
    isSameDay(dateFrom, dateTo) &&
    isSameDay(dateFrom, new Date());
  const effectivePageSize = todayRange
    ? Math.max(pageSize, dispatchCount || pageSize)
    : pageSize;
  const totalPages = Math.max(1, Math.ceil(dispatchCount / effectivePageSize) || 1);
  const safePage = Math.min(dispatchPage, totalPages - 1);
  const pageIds = useMemo(
    () => filteredDispatchIds.slice(safePage * effectivePageSize, safePage * effectivePageSize + effectivePageSize),
    [filteredDispatchIds, safePage, effectivePageSize],
  );
  const pageKey = shortIdsKey(pageIds, "dp");

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["dispatch_regs", pageKey, effectivePageSize, safePage],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_registrations")
        .select("id, invoice_number, patient_name, title, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, registered_by, due_amount, pickup_point_id")
        .in("id", pageIds);
      const order = new Map(pageIds.map((id, i) => [id, i]));
      return ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  const listLoading = loadingIds || (pageIds.length > 0 && loadingRegs);
  const regIds = registrations.map((r: any) => r.id);
  const regKey = shortIdsKey(regIds, "d");

  const invoiceNumbers = useMemo(
    () => registrations.map((r: any) => String(r.invoice_number || "").trim()).filter(Boolean),
    [registrations],
  );

  const { data: failedWaJobs = [] } = useQuery({
    queryKey: ["dispatch_failed_wa_outbox", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const cols = "id, kind, registration_id, invoice_number, phone, last_error, attempts, status";
      const [byReg, byInv] = await Promise.all([
        supabase
          .from("whatsapp_console_outbox" as any)
          .select(cols)
          .eq("status", "failed")
          .in("registration_id", regIds),
        invoiceNumbers.length
          ? supabase
              .from("whatsapp_console_outbox" as any)
              .select(cols)
              .eq("status", "failed")
              .in("invoice_number", invoiceNumbers)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const map = new Map<string, any>();
      for (const row of [...((byReg.data as any[]) || []), ...((byInv.data as any[]) || [])]) {
        if (row?.id) map.set(row.id, row);
      }
      return [...map.values()];
    },
    staleTime: 120_000,
  });

  const failedWaByRegId = useMemo(() => {
    const byReg = new Map<string, any[]>();
    const invToReg = new Map<string, string>();
    for (const reg of registrations as any[]) {
      if (reg?.invoice_number) invToReg.set(String(reg.invoice_number), reg.id);
    }
    for (const job of failedWaJobs as any[]) {
      const regId =
        job.registration_id ||
        (job.invoice_number ? invToReg.get(String(job.invoice_number)) : null);
      if (!regId) continue;
      const list = byReg.get(regId) || [];
      list.push(job);
      byReg.set(regId, list);
    }
    return byReg;
  }, [failedWaJobs, registrations]);

  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
    staleTime: 600_000,
  });

  const { data: creditPickupIds = [] } = useQuery({
    queryKey: ["dispatch_credit_pickup_points"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("id, billing_type").eq("billing_type", "credit");
      return (data || []).map((p: any) => p.id) as string[];
    },
    staleTime: 600_000,
  });
  const creditPickupSet = useMemo(() => new Set(creditPickupIds), [creditPickupIds]);
  const isPaymentBlocked = (reg: any) => {
    if (!reg) return false;
    if ((reg.due_amount ?? 0) <= 0) return false;
    if (reg.pickup_point_id && creditPickupSet.has(reg.pickup_point_id)) return false;
    return true;
  };

  // ─── Detail queries: only for the selected registration ───
  const detailEnabled = !!selectedPatientId;

  const { data: detailResults = [], isFetched: detailResultsFetched, isLoading: loadingDetailResults } = useQuery({
    queryKey: ["dispatch_detail_results", selectedPatientId],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_results")
        .select(PATIENT_RESULTS_SELECT_DISPATCH)
        .eq("registration_id", selectedPatientId!);
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });

  const { data: detailTubes = [], isFetched: detailTubesFetched, isLoading: loadingDetailTubes } = useQuery({
    queryKey: ["dispatch_detail_tubes", selectedPatientId],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("sample_tubes")
        .select("id, registration_id, test_ids, collected_at, accepted_at, status, collected_by, accepted_by")
        .eq("registration_id", selectedPatientId!);
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });

  const { data: detailSnips = [], isFetched: detailSnipsFetched, isLoading: loadingDetailSnips } = useQuery({
    queryKey: ["dispatch_detail_snips", selectedPatientId],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("outsourced_test_snips")
        .select("id, registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls, updated_at, sent_at, entered_at, entered_by, verified_at, verified_by, approved_at, approved_by, dispatched_at, dispatched_by")
        .eq("registration_id", selectedPatientId!);
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });

  const { data: detailHeld = false, isFetched: detailHeldFetched, isLoading: loadingDetailHeld } = useQuery({
    queryKey: ["dispatch_detail_held", selectedPatientId],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("approved_reports")
        .select("registration_id")
        .eq("is_held", true)
        .eq("registration_id", selectedPatientId!)
        .limit(1);
      return (data || []).length > 0;
    },
    staleTime: 60_000,
  });

  const detailLoading =
    detailEnabled &&
    (loadingDetailResults || loadingDetailTubes || loadingDetailSnips || loadingDetailHeld ||
      !detailResultsFetched || !detailTubesFetched || !detailSnipsFetched || !detailHeldFetched);

  /** Lightweight list cards — registrations only (no results/tubes/snips). */
  const listEntries = useMemo(() => {
    const rows: DispatchEntry[] = registrations
      .map((reg: any) => {
        let completionStatus: DispatchEntry["completionStatus"] = reg.bill_cancelled
          ? "cancelled"
          : dispatchDotFromRegStatus(reg.status);
        // Pending Dispatch = still has approved work. Never show blue (fully dispatched).
        if (listMode === "pending_dispatch" && completionStatus === "all_dispatched") {
          completionStatus = "all_done";
        }
        return {
          registration: reg,
          tests: [],
          completionStatus,
          approvedCount: 0,
          pendingCount: 0,
          dispatchedCount: 0,
          cancelledCount: 0,
        } as DispatchEntry;
      })
      // Hide fully-dispatched regs from Pending (stale status / orphan approved rows).
      .filter((entry) => {
        if (listMode !== "pending_dispatch") return true;
        const st = String(entry.registration.status || "").toLowerCase();
        return st !== "dispatched";
      });
    return [...rows].sort((a, b) => {
      const aCancelled = a.completionStatus === "cancelled" ? 1 : 0;
      const bCancelled = b.completionStatus === "cancelled" ? 1 : 0;
      if (aCancelled !== bCancelled) return aCancelled - bCancelled;
      const aActivestat = a.registration.is_stat && a.completionStatus !== "all_done" && a.completionStatus !== "all_dispatched" && a.completionStatus !== "cancelled" ? 1 : 0;
      const bActivestat = b.registration.is_stat && b.completionStatus !== "all_done" && b.completionStatus !== "all_dispatched" && b.completionStatus !== "cancelled" ? 1 : 0;
      if (bActivestat !== aActivestat) return bActivestat - aActivestat;
      return String(b.registration.invoice_number || "").localeCompare(String(a.registration.invoice_number || ""));
    });
  }, [registrations, listMode]);

  const selectedReg = useMemo(
    () => registrations.find((r: any) => r.id === selectedPatientId) || null,
    [registrations, selectedPatientId],
  );

  /** Full entry for detail panel — only when detail data is ready. */
  const selectedEntry = useMemo(() => {
    if (!selectedPatientId || !selectedReg) return null;
    if (detailLoading) return null;
    return buildFullDispatchEntry(selectedReg, detailResults, detailTubes, detailSnips, testsMap);
  }, [selectedPatientId, selectedReg, detailLoading, detailResults, detailTubes, detailSnips, testsMap]);

  const dispatchRegIds = useMemo(
    () =>
      listEntries
        .filter((e) => e.completionStatus !== "all_dispatched" && e.completionStatus !== "cancelled")
        .map((e) => e.registration.id),
    [listEntries],
  );
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("dispatch", dispatchRegIds);

  // Do not auto-open a patient — detail fetch only on user click (egress).
  useEffect(() => {
    if (selectedPatientId && !listEntries.find((e) => e.registration.id === selectedPatientId)) {
      setSelectedPatientId(null);
      if (isMobile) setMobileShowDetail(false);
    }
  }, [listEntries, selectedPatientId, isMobile]);

  const refreshKeys = useMemo(() => {
    const keys = ["dispatch_filtered_ids", "dispatch_regs"];
    if (selectedPatientId) {
      keys.push(
        "dispatch_detail_results",
        "dispatch_detail_tubes",
        "dispatch_detail_snips",
        "dispatch_detail_held",
        "dispatch_failed_wa_outbox",
      );
    }
    return keys;
  }, [selectedPatientId]);

  const markAsDispatched = async (entry: DispatchEntry) => {
    const reg = entry.registration;
    if (isPaymentBlocked(reg)) {
      setDueBlockEntry(entry);
      return;
    }
    const phone = String(reg.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      toast.error("No valid mobile number — cannot dispatch via WhatsApp");
      return;
    }

    const reportable = entry.tests.filter((t) => t.status === "approved" || t.status === "dispatched");
    const testIds = reportable.map((t) => t.testId);
    if (testIds.length === 0) {
      toast.error("No reports available to dispatch");
      return;
    }

    setActionKey(`${reg.id}||dispatch`);
    try {
      toast.message("Generating report PDF for WhatsApp…");
      const queued = await queueApprovedReportWhatsApp({
        registrationId: reg.id,
        testIds,
        pendingReportNames: entry.tests
          .filter((t) => t.status !== "approved" && t.status !== "dispatched")
          .map((t) => t.testName),
      });
      if (!queued.ok) {
        throw new Error(queued.error || "Failed to queue report WhatsApp");
      }

      const now = new Date().toISOString();
      const dispatcher = getCurrentUserName();
      await supabase.from("patient_results").update({
        status: "dispatched",
        dispatched_at: now,
        dispatched_by: dispatcher,
      } as any).eq("registration_id", reg.id).in("status", ["approved", "dispatched"]).in("test_id", testIds);
      await supabase.from("outsourced_test_snips").update({
        outsource_status: "dispatched",
        dispatched_at: now,
        dispatched_by: dispatcher,
      } as any).eq("registration_id", reg.id).in("outsource_status", ["approved", "dispatched"]).in("test_id", testIds);
      const stillPending = entry.tests.some((t) => t.status !== "approved" && t.status !== "dispatched");
      if (!stillPending) {
        await supabase.from("patient_registrations").update({ status: "dispatched" } as any).eq("id", reg.id);
      }
      await propagateRegistrationChange(qc, reg.id, ["dispatch", "doctor_approval"]);
      const failed = failedWaByRegId.get(reg.id) || [];
      if (failed.length) {
        await dismissFailedWhatsAppConsoleJobs(failed.map((j: any) => j.id));
        await qc.invalidateQueries({ queryKey: ["dispatch_failed_wa_outbox"] });
      }
      toast.success(`Dispatched & queued WhatsApp for ${patientDisplayName(reg)}`, {
        description: `Report PDF sending to ${phone} via WhatsApp Console`,
      });
    } catch (err: any) {
      toast.error(err.message || "Dispatch failed");
    } finally {
      setActionKey(null);
    }
  };

  /** Re-queue report PDF for already dispatched (and any still-approved) tests — status unchanged. */
  const sendReportsAgain = async (entry: DispatchEntry) => {
    const reg = entry.registration;
    if (isPaymentBlocked(reg)) {
      setDueBlockEntry(entry);
      return;
    }
    const phone = String(reg.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      toast.error("No valid mobile number — cannot send report WhatsApp");
      return;
    }

    const reportable = entry.tests.filter((t) => t.status === "approved" || t.status === "dispatched");
    const testIds = reportable.map((t) => t.testId);
    if (testIds.length === 0) {
      toast.error("No reports available to send");
      return;
    }

    setActionKey(`${reg.id}||send`);
    try {
      toast.message("Generating report PDF for WhatsApp…");
      const queued = await queueApprovedReportWhatsApp({
        registrationId: reg.id,
        testIds,
        pendingReportNames: entry.tests
          .filter((t) => t.status !== "approved" && t.status !== "dispatched")
          .map((t) => t.testName),
      });
      if (!queued.ok) {
        throw new Error(queued.error || "Failed to queue report WhatsApp");
      }
      const failed = failedWaByRegId.get(reg.id) || [];
      if (failed.length) {
        await dismissFailedWhatsAppConsoleJobs(failed.map((j: any) => j.id));
        await qc.invalidateQueries({ queryKey: ["dispatch_failed_wa_outbox"] });
      }
      toast.success(`Report queued for WhatsApp — ${patientDisplayName(reg)}`, {
        description: `Sending to ${phone} via WhatsApp Console`,
      });
    } catch (err: any) {
      toast.error(err.message || "Send reports failed");
    } finally {
      setActionKey(null);
    }
  };

  const getStatusBadge = (status: TestStatus) => {
    switch (status) {
      case "registered": return <Badge variant="outline" className="text-[10px]">Registered</Badge>;
      case "sample_collected": return <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600">Collected</Badge>;
      case "sample_accepted": return <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-700">Accepted</Badge>;
      case "results_entered": return <Badge className="text-[10px] bg-indigo-500">Entered</Badge>;
      case "verified": return <Badge className="text-[10px] bg-purple-600">Verified</Badge>;
      case "approved": return <Badge className="text-[10px] bg-green-600">Approved</Badge>;
      case "dispatched": return <Badge className="text-[10px] bg-blue-600">Dispatched</Badge>;
      case "cancelled": return <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>;
    }
  };

  const getCompletionDot = (status: DispatchEntry["completionStatus"]) => {
    switch (status) {
      case "all_dispatched": return <Circle className="h-3 w-3 fill-blue-600 text-blue-600" />;
      case "all_done": return <Circle className="h-3 w-3 fill-green-500 text-green-500" />;
      case "partial": return <Circle className="h-3 w-3 fill-amber-500 text-amber-500" />;
      case "all_pending": return <Circle className="h-3 w-3 fill-red-500 text-red-500" />;
      case "cancelled": return <Circle className="h-3 w-3 fill-slate-400 text-slate-400" />;
    }
  };

  const openReportSelectDialog = (entry: DispatchEntry) => {
    const reportableTests = entry.tests.filter((t) => t.status === "approved" || t.status === "dispatched");
    setSelectedTestIds(new Set(reportableTests.map((t) => t.testId)));
    setReportSelectEntry(entry);
  };

  const reportableTests = reportSelectEntry?.tests.filter((t) => t.status === "approved" || t.status === "dispatched") || [];
  const allReportableSelected = reportableTests.length > 0 && reportableTests.every((t) => selectedTestIds.has(t.testId));

  const toggleTestSelection = (testId: string) => {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId); else next.add(testId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allReportableSelected) setSelectedTestIds(new Set());
    else setSelectedTestIds(new Set(reportableTests.map((t) => t.testId)));
  };

  const handleGenerateReport = () => {
    if (!reportSelectEntry || selectedTestIds.size === 0) return;
    const regId = reportSelectEntry.registration.id;
    const queryParam = Array.from(selectedTestIds).join(",");
    const win = window.open(
      `/lims/report/${regId}?tests=${encodeURIComponent(queryParam)}`,
      "_blank",
      "noopener,noreferrer",
    );
    if (!win) {
      toast.error("Popup blocked — allow popups to view the report");
      return;
    }
    setReportSelectEntry(null);
  };

  const downloadAndSendManually = async (entry: DispatchEntry) => {
    const failed = failedWaByRegId.get(entry.registration.id) || [];
    const reportable = entry.tests.filter((t) => t.status === "approved" || t.status === "dispatched");
    const testIds = reportable.map((t) => t.testId);
    if (testIds.length === 0) {
      toast.error("No report PDF available to download");
      return;
    }
    setActionKey(`${entry.registration.id}||manualWa`);
    try {
      const opened = openReportForManualWhatsApp({
        registrationId: entry.registration.id,
        testIds,
        pendingReportNames: entry.tests
          .filter((t) => t.status !== "approved" && t.status !== "dispatched")
          .map((t) => t.testName),
      });
      if (!opened.ok) throw new Error(opened.error || "Could not open report download");
      if (failed.length) {
        await dismissFailedWhatsAppConsoleJobs(failed.map((j: any) => j.id));
        await qc.invalidateQueries({ queryKey: ["dispatch_failed_wa_outbox"] });
      }
      toast.success("Downloading PDF");
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    } finally {
      setActionKey(null);
    }
  };

  const clearAllFailedWaBadges = async () => {
    setActionKey("clear_failed_wa");
    try {
      const res = await dismissAllFailedWhatsAppConsoleJobs("cleared_all_failed_badges");
      if (!res.ok) throw new Error(res.error || "Clear failed");
      await qc.invalidateQueries({ queryKey: ["dispatch_failed_wa_outbox"] });
      toast.success(res.cleared ? `Cleared ${res.cleared} failed WhatsApp badge${res.cleared === 1 ? "" : "s"}` : "No failed WhatsApp badges to clear");
    } catch (err: any) {
      toast.error(err.message || "Could not clear failed badges");
    } finally {
      setActionKey(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try { return format(new Date(dateStr), "dd MMM yyyy, hh:mm a"); } catch { return dateStr; }
  };

  const showingFrom = dispatchCount === 0 ? 0 : safePage * effectivePageSize + 1;
  const showingTo = Math.min((safePage + 1) * effectivePageSize, dispatchCount);

  const goToToday = () => {
    setListMode("current");
    setIncludeOlderPending(false);
    setDateFrom(startOfDay(new Date()));
    setDateTo(endOfDay(new Date()));
    setShowAllForDay(true);
    setDispatchPage(0);
    setSelectedPatientId(null);
  };

  return (
    <div className="space-y-3">
      <SyncingOverlay target="dispatch" visibleIds={regIds} />
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm font-normal">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(dateFrom, "dd MMM yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-50" align="start">
            <DatePickerCalendar
              mode="single"
              selected={dateFrom}
              onSelect={(d) => {
                if (!d) return;
                setShowAllForDay(false);
                setDateFrom(startOfDay(d));
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <span className="text-sm text-muted-foreground">To</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm font-normal">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(dateTo, "dd MMM yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-50" align="start">
            <DatePickerCalendar
              mode="single"
              selected={dateTo}
              onSelect={(d) => {
                if (!d) return;
                setShowAllForDay(false);
                setDateTo(endOfDay(d));
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="text-xs" onClick={goToToday}>Today</Button>
        <div className="flex items-center rounded-md border p-0.5 gap-0.5">
          <Button
            type="button"
            size="sm"
            variant={listMode === "current" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5"
            onClick={() => { setShowAllForDay(false); setListMode("current"); }}
          >
            Current
          </Button>
          <Button
            type="button"
            size="sm"
            variant={listMode === "pending_dispatch" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5"
            onClick={() => { setShowAllForDay(false); setListMode("pending_dispatch"); }}
          >
            Pending Dispatch
          </Button>
        </div>
        {listMode === "pending_dispatch" && (
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <Switch
              id="dispatch-include-older"
              checked={includeOlderPending}
              onCheckedChange={setIncludeOlderPending}
            />
            <Label htmlFor="dispatch-include-older" className="text-xs font-normal cursor-pointer">
              Show older than date range
            </Label>
          </div>
        )}
        {failedWaJobs.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs text-destructive border-destructive/40"
            disabled={actionKey === "clear_failed_wa"}
            onClick={() => void clearAllFailedWaBadges()}
          >
            {actionKey === "clear_failed_wa" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Clear failed badges
          </Button>
        )}
        <RefreshButton queryKeys={refreshKeys} className="ml-auto" />
        <PageSizeSelect value={pageSize} onChange={(n) => { setShowAllForDay(false); setPageSize(n); setDispatchPage(0); }} />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {dispatchCount === 0
            ? "0 records"
            : todayRange
              ? `Showing all ${dispatchCount} for today`
              : `Showing ${showingFrom}–${showingTo} of ${dispatchCount}`}
        </span>
        <Button variant="outline" size="sm" disabled={safePage <= 0} onClick={() => setDispatchPage((p) => Math.max(0, p - 1))}>
          Prev
        </Button>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Page {safePage + 1} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1 || dispatchCount === 0} onClick={() => setDispatchPage((p) => p + 1)}>
          Next
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        {listMode === "current"
          ? todayRange
            ? "Today — all patients registered today (Current board)."
            : "Current — all bills in the date range (includes blue / fully dispatched)."
          : `Pending Dispatch — approved reports not yet dispatched (fully dispatched / blue hidden)${includeOlderPending ? "; includes older than range" : ""}.`}
      </p>

      {(
        <div className={cn("flex gap-3", isMobile && "flex-col")} style={{ height: "calc(100vh - 180px)" }}>
          {/* LEFT PANEL — Patient List */}
          {(!isMobile || !mobileShowDetail) && (
            <Card className={cn("flex flex-col overflow-hidden", isMobile ? "w-full" : "w-[380px] shrink-0")}>
              <div className="p-3 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search name, mobile, invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {listLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : listEntries.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground px-3">
                    <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">
                      {listMode === "pending_dispatch" ? "No pending dispatch" : "No patients in this date range"}
                    </p>
                    <p className="text-xs">
                      {listMode === "pending_dispatch"
                        ? (includeOlderPending
                          ? "No bills with approved reports waiting to dispatch"
                          : "No pending bills in this date range — try widening dates or enable older")
                        : "Adjust dates or search to check patient status"}
                    </p>
                  </div>
                ) : (
                <div className="divide-y">
                  {listEntries.map((entry) => {
                    const reg = entry.registration;
                    const isSelected = selectedPatientId === reg.id;
                    const showHeld = isSelected && detailHeld && entry.completionStatus !== "cancelled";
                    return (
                      <div
                        key={reg.id}
                        className={`px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}`}
                        onClick={() => { markArrivalSeen(reg.id); setSelectedPatientId(reg.id); if (isMobile) setMobileShowDetail(true); }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-1 shrink-0">{getCompletionDot(entry.completionStatus)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {reg.is_stat && entry.completionStatus !== "all_done" && entry.completionStatus !== "all_dispatched" && entry.completionStatus !== "cancelled" && <span className="relative flex h-2 w-2 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" /></span>}
                              <span className={cn("font-semibold text-sm truncate tracking-wide", entry.completionStatus === "cancelled" && "line-through text-muted-foreground")}>{reg.invoice_number}</span>
                              <NewBadge show={isNewArrival(reg.id)} />
                              {entry.completionStatus === "cancelled" && <Badge variant="destructive" className="text-[10px] px-1 py-0">Cancelled</Badge>}
                              {showHeld && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500 text-amber-700">Held</Badge>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                              <span className={cn("text-xs text-muted-foreground truncate", entry.completionStatus === "cancelled" && "line-through")}>{patientDisplayName(reg)}</span>
                              <Badge variant="outline" className="text-[10px] font-mono shrink-0 px-1 py-0">{formatAgeGender(reg.dob, reg.gender)}</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{reg.mobile_number}</span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <CalendarIcon className="h-3 w-3" />
                                {formatDate(reg.created_at)}
                              </span>
                            </div>
                            {reg.due_amount > 0 && (
                              <Badge variant={isPaymentBlocked(reg) ? "destructive" : "secondary"} className="mt-1 text-[10px] px-1.5 py-0">
                                DUE ₹{reg.due_amount}{!isPaymentBlocked(reg) ? " · CREDIT" : ""}
                              </Badge>
                            )}
                            {(failedWaByRegId.get(reg.id) || []).length > 0 && (
                              <Badge variant="destructive" className="mt-1 text-[10px] px-1.5 py-0">
                                WhatsApp Sending failed
                              </Badge>
                            )}
                          </div>
                          {isMobile && <ChevronRight className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            </Card>
          )}

          {/* RIGHT PANEL — Selected Patient Details */}
          {(!isMobile || mobileShowDetail) && (
            <Card className={cn("flex flex-col overflow-hidden", isMobile ? "w-full flex-1" : "flex-1")}>
              {detailLoading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : selectedEntry ? (
                <>
                  {/* Patient header */}
                  <div className="p-4 border-b bg-muted/20">
                    <div className={cn("flex items-start justify-between gap-3", isMobile && "flex-col")}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isMobile && (
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setMobileShowDetail(false)}>
                              <ArrowLeft className="h-4 w-4" />
                            </Button>
                          )}
                          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                          <h3 className={cn("font-semibold", isMobile ? "text-base" : "text-lg", selectedEntry.completionStatus === "cancelled" && "line-through text-muted-foreground")}>{selectedEntry.registration.invoice_number}</h3>
                          {selectedEntry.completionStatus === "cancelled" && <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>}
                          {detailHeld && selectedEntry.completionStatus !== "cancelled" && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">Held</Badge>}
                          {selectedEntry.registration.is_stat && selectedEntry.completionStatus !== "all_done" && selectedEntry.completionStatus !== "all_dispatched" && selectedEntry.completionStatus !== "cancelled" && <Badge variant="destructive" className="text-[10px]">STAT</Badge>}
                          {getCompletionDot(selectedEntry.completionStatus)}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className={cn("text-sm text-muted-foreground", selectedEntry.completionStatus === "cancelled" && "line-through")}>{patientDisplayName(selectedEntry.registration)}</span>
                          <Badge variant="outline" className="text-xs font-mono">{formatAgeGender(selectedEntry.registration.dob, selectedEntry.registration.gender)}</Badge>
                        </div>
                        <div className={cn("flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap", isMobile && "gap-2 text-xs")}>
                          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selectedEntry.registration.mobile_number}</span>
                          {selectedEntry.registration.umr_number && <span>UMR: {selectedEntry.registration.umr_number}</span>}
                          {!isMobile && <span className="flex items-center gap-1"><CalendarIcon className="h-3.5 w-3.5" />{formatDate(selectedEntry.registration.created_at)}</span>}
                        </div>
                      </div>
                      {selectedEntry.registration.due_amount > 0 && (
                        <Badge variant={isPaymentBlocked(selectedEntry.registration) ? "destructive" : "secondary"} className="text-xs px-2 py-1 shrink-0">
                          DUE ₹{selectedEntry.registration.due_amount}{!isPaymentBlocked(selectedEntry.registration) ? " · CREDIT" : ""}
                        </Badge>
                      )}
                    </div>
                    {(failedWaByRegId.get(selectedEntry.registration.id) || []).length > 0 && (
                      <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 space-y-2">
                        <p className="text-sm font-semibold text-destructive">WhatsApp Sending failed</p>
                        <p className="text-xs text-muted-foreground">
                          The number may not be registered on WhatsApp. Download the report PDF and send it manually.
                        </p>
                        {selectedEntry.tests.some((t) => t.status === "approved" || t.status === "dispatched") && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="gap-1 h-8"
                            disabled={actionKey === `${selectedEntry.registration.id}||manualWa`}
                            onClick={() => void downloadAndSendManually(selectedEntry)}
                          >
                            {actionKey === `${selectedEntry.registration.id}||manualWa` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            Download PDF
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                      {selectedEntry.tests.some((t) => t.status === "approved" || t.status === "dispatched") && (
                        <Button size="sm" variant="outline" className="gap-1" disabled={isPaymentBlocked(selectedEntry.registration)} onClick={() => openReportSelectDialog(selectedEntry)}>
                          <Eye className="h-4 w-4" /> View Report
                        </Button>
                      )}
                      {(selectedEntry.dispatchedCount > 0 || selectedEntry.tests.some((t) => t.status === "dispatched")) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          disabled={actionKey === `${selectedEntry.registration.id}||send`}
                          onClick={() => sendReportsAgain(selectedEntry)}
                        >
                          {actionKey === `${selectedEntry.registration.id}||send` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageSquare className="h-4 w-4" />
                          )}
                          Send Reports
                        </Button>
                      )}
                      {(selectedEntry.approvedCount > 0 || selectedEntry.dispatchedCount > 0) && (
                        <Button size="sm" className="gap-1" disabled={actionKey === `${selectedEntry.registration.id}||dispatch`} onClick={() => markAsDispatched(selectedEntry)}>
                          {actionKey === `${selectedEntry.registration.id}||dispatch` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Dispatch All
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Test details list with audit trail */}
                  <ScrollArea className="flex-1">
                    <div className="p-4 space-y-3">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Tests ({selectedEntry.tests.length})
                      </div>
                      {selectedEntry.tests.map((test) => {
                        const testKey = `${selectedEntry.registration.id}||${test.testId}`;

                        const auditSteps = [
                          { label: "Registered", timestamp: selectedEntry.registration.created_at, by: test.registeredBy || "—" },
                          { label: "Sample Collected", timestamp: test.collectedAt, by: test.collectedBy },
                          { label: "Sample Accepted", timestamp: test.acceptedAt, by: test.acceptedBy },
                          { label: "Results Entered", timestamp: test.enteredAt, by: test.enteredBy },
                          { label: "Verified", timestamp: test.verifiedAt, by: test.verifiedBy },
                          { label: "Approved", timestamp: test.approvedAt, by: test.approvedBy },
                          { label: "Dispatched", timestamp: test.dispatchedAt, by: test.dispatchedBy },
                        ];

                        return (
                          <Collapsible key={testKey} className="border rounded-lg bg-background">
                            <div className={cn("flex items-center justify-between px-4 py-3", isMobile && "flex-wrap gap-2 px-3 py-2")}>
                              <div className="flex items-center gap-2 min-w-0">
                                <CollapsibleTrigger className="flex items-center gap-2 group cursor-pointer text-left">
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                                  <span className={cn("font-medium text-sm", test.status === "cancelled" && "line-through text-muted-foreground")}>{test.testName}</span>
                                </CollapsibleTrigger>
                              </div>
                              <div className={cn("flex items-center gap-1.5 shrink-0", isMobile && "flex-wrap w-full justify-end")}>
                                {test.status === "approved" && test.snipUrls.length > 0 && (
                                  <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" disabled={isPaymentBlocked(selectedEntry.registration)} onClick={() => setViewSnipImages(test.snipUrls)}>
                                    <Eye className="h-3.5 w-3.5" /> Snip
                                  </Button>
                                )}
                                {(() => {
                                  const startTime = test.collectedAt;
                                  const endTime = test.dispatchedAt;
                                  if (startTime) {
                                    const start = new Date(startTime).getTime();
                                    const end = endTime ? new Date(endTime).getTime() : Date.now();
                                    const diffMs = end - start;
                                    const totalMins = Math.floor(diffMs / 60000);
                                    const hrs = Math.floor(totalMins / 60);
                                    const mins = totalMins % 60;
                                    const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                    return (
                                      <Badge variant="outline" className={`text-xs px-2 py-0.5 h-6 font-mono ${endTime ? "border-emerald-500 text-emerald-700 bg-emerald-50" : "border-sky-400 text-sky-600 bg-sky-50"}`}>
                                        <Clock className="h-3 w-3 mr-1" />{label}
                                      </Badge>
                                    );
                                  }
                                  return null;
                                })()}
                                {getStatusBadge(test.status)}
                              </div>
                            </div>
                            <CollapsibleContent>
                              <div className="px-4 py-2.5 border-t">
                                <div className="space-y-1">
                                  {auditSteps.map((step, idx) => {
                                    const isDone = !!step.timestamp;
                                    return (
                                      <div key={idx} className={cn("grid items-center gap-1 py-0.5", isMobile ? "grid-cols-[20px_110px_1fr_1fr]" : "grid-cols-[24px_150px_1fr_1fr]")}>
                                        <div className="flex justify-center">
                                          {isDone ? (
                                            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                                          ) : (
                                            <div className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/30" />
                                          )}
                                        </div>
                                        <span className={`text-xs ${isDone ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                          {step.label}
                                        </span>
                                        <span className={`text-xs ${isDone ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                                          {isDone ? formatDate(step.timestamp) : "—"}
                                        </span>
                                        <span className={`text-xs ${isDone && step.by ? "text-primary font-medium" : "text-muted-foreground/40"}`}>
                                          {isDone && step.by ? `by ${step.by}` : ""}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Select a patient to view details</p>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Snip viewer dialog */}
      <Dialog open={!!viewSnipImages} onOpenChange={(open) => { if (!open) setViewSnipImages(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outsourced Result — Snipped Images</DialogTitle></DialogHeader>
          <div className="space-y-4">{viewSnipImages?.map((url, idx) => (<div key={idx} className="border rounded-lg overflow-hidden"><img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" /></div>))}</div>
        </DialogContent>
      </Dialog>

      {/* Report select dialog */}
      <Dialog open={!!reportSelectEntry} onOpenChange={(open) => { if (!open) setReportSelectEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Select Tests for Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer border-b pb-2">
              <input type="checkbox" checked={allReportableSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-input" />
              <span className="font-medium text-sm">Select All ({reportableTests.length} tests)</span>
            </label>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {reportableTests.map((test) => (
                <label key={test.testId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <input type="checkbox" checked={selectedTestIds.has(test.testId)} onChange={() => toggleTestSelection(test.testId)} className="h-4 w-4 rounded border-input" />
                  <span className="text-sm">{test.testName}</span>
                  {getStatusBadge(test.status)}
                </label>
              ))}
            </div>
            <Button className="w-full" disabled={selectedTestIds.size === 0 || isPaymentBlocked(reportSelectEntry?.registration)} onClick={handleGenerateReport}>
              <Eye className="h-4 w-4 mr-1" /> Generate Report ({selectedTestIds.size} test{selectedTestIds.size !== 1 ? "s" : ""})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!dueBlockEntry} onOpenChange={(open) => { if (!open) setDueBlockEntry(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Payment due — cannot dispatch</AlertDialogTitle>
            <AlertDialogDescription>
              {dueBlockEntry
                ? `${patientDisplayName(dueBlockEntry.registration)} has a due amount of ₹${Number(dueBlockEntry.registration.due_amount || 0).toLocaleString("en-IN")}. Collect payment before dispatching reports.`
                : "Collect payment before dispatching reports."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDueBlockEntry(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dispatch;
