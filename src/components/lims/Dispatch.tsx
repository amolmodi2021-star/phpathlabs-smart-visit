import { useState, useEffect, useMemo } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import SyncingOverlay from "./SyncingOverlay";
import { formatAgeGender } from "@/lib/ageGender";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";

const DISPATCH_PAGE_SIZE = 50;
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Loader2, CheckCircle2, Send, Eye, Truck, MessageSquare, Circle, Phone, Calendar as CalendarIcon, FileText, User, Clock, ChevronRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import NewBadge from "./NewBadge";

type TestStatus = "registered" | "sample_collected" | "sample_accepted" | "results_entered" | "verified" | "approved" | "dispatched";

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
  completionStatus: "all_done" | "partial" | "all_pending";
  approvedCount: number;
  pendingCount: number;
}

const Dispatch = () => {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<Date>(startOfDay(subDays(new Date(), 7)));
  const [dateTo, setDateTo] = useState<Date>(endOfDay(new Date()));
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const [reportSelectEntry, setReportSelectEntry] = useState<DispatchEntry | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [dispatchPage, setDispatchPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setDispatchPage(0); }, 400); return () => clearTimeout(t); }, [search]);

  const { data: dispatchCount = 0 } = useQuery({
    queryKey: ["dispatch_regs_count", debouncedSearch, dateFrom.toISOString(), dateTo.toISOString()],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("id", { count: "exact", head: true })
        .eq("bill_cancelled", false)
        .gte("created_at", dateFrom.toISOString())
        .lte("created_at", dateTo.toISOString());
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { count } = await query;
      return count || 0;
    },
  });

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["dispatch_regs", debouncedSearch, dateFrom.toISOString(), dateTo.toISOString(), dispatchPage],
    queryFn: async () => {
      let query = supabase.from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, registered_by, due_amount")
        .eq("bill_cancelled", false)
        .gte("created_at", dateFrom.toISOString())
        .lte("created_at", dateTo.toISOString())
        .order("is_stat", { ascending: false })
        .order("invoice_number", { ascending: false })
        .range(dispatchPage * DISPATCH_PAGE_SIZE, dispatchPage * DISPATCH_PAGE_SIZE + DISPATCH_PAGE_SIZE - 1);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const dispatchTotalPages = Math.ceil(dispatchCount / DISPATCH_PAGE_SIZE);

  const regIds = registrations.map((r: any) => r.id);

  const { data: allResults = [] } = useQuery({
    queryKey: ["dispatch_all_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  const { data: allTubes = [] } = useQuery({
    queryKey: ["dispatch_all_tubes", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("sample_tubes" as any).select("registration_id, test_ids, collected_at, accepted_at, status, collected_by, accepted_by").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  const { data: allSnips = [] } = useQuery({
    queryKey: ["dispatch_all_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls, updated_at, sent_at").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  const { data: heldRegIds = [] } = useQuery({
    queryKey: ["dispatch_held_reports", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("approved_reports").select("registration_id").eq("is_held", true).in("registration_id", regIds);
      return (data || []).map((r: any) => r.registration_id) as string[];
    },
  });

  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => { const { data } = await supabase.from("tests").select("id, test_name"); const map: Record<string, any> = {}; (data || []).forEach((t: any) => { map[t.id] = t; }); return map; },
  });

  const heldSet = useMemo(() => new Set(heldRegIds), [heldRegIds]);

  const dispatchEntries = useMemo(() => {
    return registrations.filter((reg: any) => !heldSet.has(reg.id)).map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      // Build leaf-id set from this registration's tubes (handles PRL/HLT expansion)
      const leafIds = new Set<string>();
      for (const tb of allTubes) {
        if (tb.registration_id !== reg.id) continue;
        const ids = Array.isArray(tb.test_ids) ? tb.test_ids : [];
        ids.forEach((id: string) => leafIds.add(id));
      }
      const expandedTests = expandRegistrationTests(tests, leafIds, testsMap);
      const activeTests = expandedTests.filter((t: any) => !cancelledIds.has(t.test_id));
      if (activeTests.length === 0) return null;

      const dispatchTests: DispatchTest[] = [];
      for (const t of activeTests) {
        const testInfo = testsMap[t.test_id] || {};
        const testResults = allResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
        const snip = allSnips.find((s: any) => s.registration_id === reg.id && s.test_id === t.test_id);

        // Find tube for this test
        const tube = allTubes.find((tb: any) => tb.registration_id === reg.id && Array.isArray(tb.test_ids) && tb.test_ids.includes(t.test_id));

        const hasDispatchedResults = testResults.some((r: any) => r.status === "dispatched");
        const hasDispatchedSnip = snip && snip.outsource_status === "dispatched";
        const hasApprovedResults = testResults.some((r: any) => r.status === "approved");
        const hasApprovedSnip = snip && snip.outsource_status === "approved";
        const hasVerifiedResults = testResults.some((r: any) => r.status === "verified");
        const hasVerifiedSnip = snip && snip.outsource_status === "verified";
        const hasEnteredResults = testResults.some((r: any) => r.status === "entered" || r.status === "results_entered");
        const hasEnteredSnip = snip && (snip.outsource_status === "results_entered" || snip.outsource_status === "results_saved");

        let status: TestStatus = "registered";
        const regStatus = reg.status as string;
        if (hasDispatchedResults || hasDispatchedSnip) status = "dispatched";
        else if (hasApprovedResults || hasApprovedSnip) status = "approved";
        else if (hasVerifiedResults || hasVerifiedSnip) status = "verified";
        else if (hasEnteredResults || hasEnteredSnip) status = "results_entered";
        else if (regStatus === "sample_accepted" || testResults.length > 0) status = "sample_accepted";
        else if (regStatus === "sample_collected") status = "sample_collected";

        const snipUrls = snip && snip.result_mode === "snip" && Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls : [];
        const approvedResults = testResults.filter((r: any) => r.status === "approved");

        // Extract audit timestamps
        const collectedAt = tube?.collected_at || null;
        const acceptedAt = tube?.accepted_at || null;
        // Get the earliest entered_at, verified_at, approved_at, dispatched_at from results
        const getEarliest = (field: string) => {
          const vals = testResults.map((r: any) => r[field]).filter(Boolean);
          return vals.length > 0 ? vals.sort()[0] : null;
        };

        // For snip-only outsourced tests, derive timestamps from outsourced_test_snips
        let enteredAt = getEarliest("entered_at");
        let verifiedAt = getEarliest("verified_at");
        let approvedAtTs = getEarliest("approved_at");
        let dispatchedAtTs = getEarliest("dispatched_at");
        if (snip && testResults.length === 0) {
          const snipStatus = snip.outsource_status;
          const snipTime = snip.updated_at || snip.sent_at || null;
          if (["results_entered", "results_saved", "verified", "approved", "dispatched"].includes(snipStatus) && !enteredAt) {
            enteredAt = snipTime;
          }
          if (["verified", "approved", "dispatched"].includes(snipStatus) && !verifiedAt) {
            verifiedAt = snipTime;
          }
          if (["approved", "dispatched"].includes(snipStatus) && !approvedAtTs) {
            approvedAtTs = snipTime;
          }
          if (snipStatus === "dispatched" && !dispatchedAtTs) {
            dispatchedAtTs = snipTime;
          }
        }

        // Extract _by fields
        const getFirstBy = (field: string) => {
          const vals = testResults.map((r: any) => r[field]).filter(Boolean);
          return vals.length > 0 ? vals[0] : null;
        };

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
          enteredBy: getFirstBy("entered_by"),
          verifiedBy: getFirstBy("verified_by"),
          approvedBy: getFirstBy("approved_by"),
          dispatchedBy: getFirstBy("dispatched_by"),
        });
      }

      const approvedCount = dispatchTests.filter(t => t.status === "approved").length;
      const pendingCount = dispatchTests.filter(t => t.status !== "approved" && t.status !== "dispatched").length;
      const nonDispatchedCount = approvedCount + pendingCount;

      let completionStatus: "all_done" | "partial" | "all_pending" = "all_pending";
      if (nonDispatchedCount === 0) completionStatus = "all_done";
      else if (pendingCount === 0) completionStatus = "all_done";
      else if (approvedCount > 0) completionStatus = "partial";

      return { registration: reg, tests: dispatchTests, completionStatus, approvedCount, pendingCount } as DispatchEntry;
    }).filter(Boolean) as DispatchEntry[];
  }, [registrations, allResults, allSnips, allTubes, testsMap, heldSet]);

  // Re-sort: active STAT on top, completed STAT loses priority
  const sortedDispatchEntries = useMemo(() => {
    return [...dispatchEntries].sort((a, b) => {
      const aActivestat = a.registration.is_stat && a.completionStatus !== "all_done" ? 1 : 0;
      const bActivestat = b.registration.is_stat && b.completionStatus !== "all_done" ? 1 : 0;
      if (bActivestat !== aActivestat) return bActivestat - aActivestat;
      return String(b.registration.invoice_number || "").localeCompare(String(a.registration.invoice_number || ""));
    });
  }, [dispatchEntries]);

  // ─── NEW arrivals badge tracker ───
  const dispatchRegIds = useMemo(() => sortedDispatchEntries.map(e => e.registration.id), [sortedDispatchEntries]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("dispatch", dispatchRegIds);

  // Auto-select first patient when entries change
  useEffect(() => {
    if (sortedDispatchEntries.length > 0 && (!selectedPatientId || !sortedDispatchEntries.find(e => e.registration.id === selectedPatientId))) {
      setSelectedPatientId(sortedDispatchEntries[0].registration.id);
    }
  }, [sortedDispatchEntries, selectedPatientId]);

  const selectedEntry = useMemo(() => sortedDispatchEntries.find(e => e.registration.id === selectedPatientId) || null, [sortedDispatchEntries, selectedPatientId]);

  const dispatchViaWhatsApp = async (reg: any) => {
    const phone = (reg.mobile_number || "").replace(/\D/g, "");
    if (!phone) { toast.error("No mobile number available"); return; }
    let portalUrl = "";
    try {
      const { createShareLink } = await import("@/lib/reportShareLinks");
      const created = await createShareLink(reg.id, reg.invoice_number, getCurrentUserName());
      portalUrl = created.url;
    } catch (e: any) {
      console.error("Failed to create share link", e);
      toast.error("Couldn't generate report link, sending without it");
    }
    const linkLine = portalUrl
      ? `\n\nView status & download:\n${portalUrl}\n(Link valid for 7 days)`
      : "";
    const message = `Dear ${reg.patient_name},\n\nYour lab reports for Invoice ${reg.invoice_number} are ready.${linkLine}\n\nThank you for choosing PH PathLabs.\nLabLine: 6356 55 66 99`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const markAsDispatched = async (entry: DispatchEntry) => {
    const reg = entry.registration;
    setActionKey(`${reg.id}||dispatch`);
    try {
      const approvedTests = entry.tests.filter(t => t.status === "approved");
      for (const test of approvedTests) {
        await supabase.from("patient_results").update({ status: "dispatched", dispatched_at: new Date().toISOString(), dispatched_by: getCurrentUserName() } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("status", "approved");
        await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("outsource_status", "approved");
      }
      const stillPending = entry.tests.some(t => t.status !== "approved" && t.status !== "dispatched");
      if (!stillPending) {
        await supabase.from("patient_registrations").update({ status: "dispatched" } as any).eq("id", reg.id);
      }
      await propagateRegistrationChange(qc, reg.id, ["dispatch", "doctor_approval"]);
      toast.success(`Reports dispatched for ${reg.patient_name}`);
    } catch (err: any) { toast.error(err.message || "Dispatch failed"); }
    finally { setActionKey(null); }
  };

  const markTestDispatched = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||dispatch`);
    try {
      await supabase.from("patient_results").update({ status: "dispatched", dispatched_at: new Date().toISOString(), dispatched_by: getCurrentUserName() } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "approved");
      await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", regId).eq("test_id", testId).eq("outsource_status", "approved");
      await propagateRegistrationChange(qc, regId, ["dispatch"]);
      toast.success(`${testName} marked as dispatched`);
    } catch (err: any) { toast.error(err.message || "Dispatch failed"); }
    finally { setActionKey(null); }
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
    }
  };

  const getCompletionDot = (status: "all_done" | "partial" | "all_pending") => {
    switch (status) {
      case "all_done": return <Circle className="h-3 w-3 fill-green-500 text-green-500" />;
      case "partial": return <Circle className="h-3 w-3 fill-amber-500 text-amber-500" />;
      case "all_pending": return <Circle className="h-3 w-3 fill-red-500 text-red-500" />;
    }
  };

  const openReportSelectDialog = (entry: DispatchEntry) => {
    const reportableTests = entry.tests.filter(t => t.status === "approved" || t.status === "dispatched");
    setSelectedTestIds(new Set(reportableTests.map(t => t.testId)));
    setReportSelectEntry(entry);
  };

  const reportableTests = reportSelectEntry?.tests.filter(t => t.status === "approved" || t.status === "dispatched") || [];
  const allReportableSelected = reportableTests.length > 0 && reportableTests.every(t => selectedTestIds.has(t.testId));

  const toggleTestSelection = (testId: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId); else next.add(testId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allReportableSelected) setSelectedTestIds(new Set());
    else setSelectedTestIds(new Set(reportableTests.map(t => t.testId)));
  };

  const handleGenerateReport = () => {
    if (!reportSelectEntry || selectedTestIds.size === 0) return;
    const regId = reportSelectEntry.registration.id;
    const queryParam = Array.from(selectedTestIds).join(",");
    navigate(`/lims/report/${regId}?tests=${queryParam}`);
    setReportSelectEntry(null);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try { return format(new Date(dateStr), "dd MMM yyyy, hh:mm a"); } catch { return dateStr; }
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
              onSelect={(d) => d && setDateFrom(startOfDay(d))}
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
              onSelect={(d) => d && setDateTo(endOfDay(d))}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setDateFrom(startOfDay(new Date())); setDateTo(endOfDay(new Date())); }}>Today</Button>
        <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">{dispatchCount} records{dispatchTotalPages > 1 ? ` (pg ${dispatchPage + 1}/${dispatchTotalPages})` : ""}</span>
      </div>

      {loadingRegs ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : sortedDispatchEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No reports pending dispatch</p>
          <p className="text-sm">All approved reports have been dispatched</p>
        </div>
      ) : (
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
              <ScrollArea className="flex-1">
                <div className="divide-y">
                  {sortedDispatchEntries.map((entry) => {
                    const reg = entry.registration;
                    const isSelected = selectedPatientId === reg.id;
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
                              {reg.is_stat && entry.completionStatus !== "all_done" && <span className="relative flex h-2 w-2 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" /></span>}
                              <span className="font-medium text-sm truncate">{reg.patient_name}</span>
                              <NewBadge show={isNewArrival(reg.id)} />
                              <Badge variant="outline" className="text-[10px] font-mono shrink-0 px-1 py-0">{formatAgeGender(reg.dob, reg.gender)}</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{reg.mobile_number}</span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />{reg.invoice_number}</span>
                              <span className="text-[10px] text-muted-foreground">{entry.approvedCount}A / {entry.pendingCount}P</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                              <CalendarIcon className="h-3 w-3" />
                              {formatDate(reg.created_at)}
                            </div>
                            {reg.due_amount > 0 && (
                              <Badge variant="destructive" className="mt-1 text-[10px] px-1.5 py-0">
                                DUE ₹{reg.due_amount}
                              </Badge>
                            )}
                          </div>
                          {isMobile && <ChevronRight className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
              {dispatchTotalPages > 1 && (
                <div className="p-2 border-t flex items-center justify-between">
                  <Button variant="ghost" size="sm" className="text-xs h-7" disabled={dispatchPage === 0} onClick={() => setDispatchPage(p => p - 1)}>Prev</Button>
                  <span className="text-xs text-muted-foreground">{dispatchPage + 1} / {dispatchTotalPages}</span>
                  <Button variant="ghost" size="sm" className="text-xs h-7" disabled={dispatchPage >= dispatchTotalPages - 1} onClick={() => setDispatchPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </Card>
          )}

          {/* RIGHT PANEL — Selected Patient Details */}
          {(!isMobile || mobileShowDetail) && (
            <Card className={cn("flex flex-col overflow-hidden", isMobile ? "w-full flex-1" : "flex-1")}>
              {selectedEntry ? (
                <>
                  {/* Patient header */}
                  <div className="p-4 border-b bg-muted/20">
                    <div className={cn("flex items-start justify-between", isMobile && "flex-col gap-3")}>
                      <div>
                        <div className="flex items-center gap-2">
                          {isMobile && (
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setMobileShowDetail(false)}>
                              <ArrowLeft className="h-4 w-4" />
                            </Button>
                          )}
                          <User className="h-5 w-5 text-muted-foreground" />
                          <h3 className={cn("font-semibold", isMobile ? "text-base" : "text-lg")}>{selectedEntry.registration.patient_name}</h3>
                          <Badge variant="outline" className="text-xs font-mono">{formatAgeGender(selectedEntry.registration.dob, selectedEntry.registration.gender)}</Badge>
                          {selectedEntry.registration.is_stat && selectedEntry.completionStatus !== "all_done" && <Badge variant="destructive" className="text-[10px]">STAT</Badge>}
                          {getCompletionDot(selectedEntry.completionStatus)}
                        </div>
                        <div className={cn("flex items-center gap-4 mt-1 text-sm text-muted-foreground", isMobile && "flex-wrap gap-2 text-xs")}>
                          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selectedEntry.registration.mobile_number}</span>
                          <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{selectedEntry.registration.invoice_number}</span>
                          {selectedEntry.registration.umr_number && <span>UMR: {selectedEntry.registration.umr_number}</span>}
                          {!isMobile && <span className="flex items-center gap-1"><CalendarIcon className="h-3.5 w-3.5" />{formatDate(selectedEntry.registration.created_at)}</span>}
                        </div>
                      </div>
                      <div className={cn("flex items-center gap-2", isMobile && "w-full overflow-x-auto")}>
                        {selectedEntry.registration.due_amount > 0 && (
                          <Badge variant="destructive" className="text-xs px-2 py-1 shrink-0">
                            DUE ₹{selectedEntry.registration.due_amount}
                          </Badge>
                        )}
                        {selectedEntry.tests.some(t => t.status === "approved" || t.status === "dispatched") && (
                          <>
                            <Button size="sm" variant="outline" className="gap-1 shrink-0" disabled={selectedEntry.registration.due_amount > 0} onClick={() => openReportSelectDialog(selectedEntry)}>
                              <Eye className="h-4 w-4" /> {!isMobile && "View"} Report
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1 shrink-0" disabled={selectedEntry.registration.due_amount > 0} onClick={() => dispatchViaWhatsApp(selectedEntry.registration)}>
                              <MessageSquare className="h-4 w-4" /> {!isMobile && "WhatsApp"}
                            </Button>
                          </>
                        )}
                        {selectedEntry.approvedCount > 0 && (
                          <Button size="sm" className="gap-1 shrink-0" disabled={selectedEntry.registration.due_amount > 0 || actionKey === `${selectedEntry.registration.id}||dispatch`} onClick={() => markAsDispatched(selectedEntry)}>
                            {actionKey === `${selectedEntry.registration.id}||dispatch` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Dispatch All
                          </Button>
                        )}
                      </div>
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
                        const isTestDispatching = actionKey === `${testKey}||dispatch`;

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
                            {/* Test header */}
                            <div className={cn("flex items-center justify-between px-4 py-3", isMobile && "flex-wrap gap-2 px-3 py-2")}>
                              <div className="flex items-center gap-2 min-w-0">
                                <CollapsibleTrigger className="flex items-center gap-2 group cursor-pointer text-left">
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                                  <span className="font-medium text-sm">{test.testName}</span>
                                </CollapsibleTrigger>
                              </div>
                              <div className={cn("flex items-center gap-1.5 shrink-0", isMobile && "flex-wrap w-full justify-end")}>
                                {/* View Snip */}
                                {test.status === "approved" && test.snipUrls.length > 0 && (
                                  <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" disabled={selectedEntry.registration.due_amount > 0} onClick={() => setViewSnipImages(test.snipUrls)}>
                                    <Eye className="h-3.5 w-3.5" /> Snip
                                  </Button>
                                )}
                                {/* TAT badge */}
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
                                {/* Status badge */}
                                {getStatusBadge(test.status)}
                                {/* WhatsApp & Dispatch */}
                                {test.status === "approved" && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={selectedEntry.registration.due_amount > 0} onClick={() => dispatchViaWhatsApp(selectedEntry.registration)}>
                                      <MessageSquare className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="sm" className="h-8 text-xs gap-1" disabled={selectedEntry.registration.due_amount > 0 || isTestDispatching} onClick={() => markTestDispatched(selectedEntry.registration.id, test.testId, test.testName)}>
                                      {isTestDispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Dispatch
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Collapsible audit trail */}
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
      <Dialog open={!!viewSnipImages} onOpenChange={open => { if (!open) setViewSnipImages(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outsourced Result — Snipped Images</DialogTitle></DialogHeader>
          <div className="space-y-4">{viewSnipImages?.map((url, idx) => (<div key={idx} className="border rounded-lg overflow-hidden"><img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" /></div>))}</div>
        </DialogContent>
      </Dialog>

      {/* Report select dialog */}
      <Dialog open={!!reportSelectEntry} onOpenChange={open => { if (!open) setReportSelectEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Select Tests for Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer border-b pb-2">
              <input type="checkbox" checked={allReportableSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-input" />
              <span className="font-medium text-sm">Select All ({reportableTests.length} tests)</span>
            </label>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {reportableTests.map(test => (
                <label key={test.testId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <input type="checkbox" checked={selectedTestIds.has(test.testId)} onChange={() => toggleTestSelection(test.testId)} className="h-4 w-4 rounded border-input" />
                  <span className="text-sm">{test.testName}</span>
                  {getStatusBadge(test.status)}
                </label>
              ))}
            </div>
            <Button className="w-full" disabled={selectedTestIds.size === 0 || (reportSelectEntry?.registration?.due_amount ?? 0) > 0} onClick={handleGenerateReport}>
              <Eye className="h-4 w-4 mr-1" /> Generate Report ({selectedTestIds.size} test{selectedTestIds.size !== 1 ? "s" : ""})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dispatch;
