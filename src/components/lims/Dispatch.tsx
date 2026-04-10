import { useState, useEffect, useMemo } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Search, Loader2, CheckCircle2, Send, Eye, Truck, MessageSquare, Circle, Phone, Calendar, FileText, User, Clock, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

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
}

interface DispatchEntry {
  registration: any;
  tests: DispatchTest[];
  completionStatus: "all_done" | "partial" | "all_pending";
  approvedCount: number;
  pendingCount: number;
}

const Dispatch = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const [reportSelectEntry, setReportSelectEntry] = useState<DispatchEntry | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["dispatch_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("*")
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

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
      const { data } = await supabase.from("sample_tubes" as any).select("registration_id, test_ids, collected_at, accepted_at, status").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  const { data: allSnips = [] } = useQuery({
    queryKey: ["dispatch_all_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls").in("registration_id", regIds);
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
      const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));
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

        dispatchTests.push({
          testId: t.test_id,
          testName: t.test_name || testInfo.test_name || "Unknown",
          status,
          results: approvedResults,
          snipUrls: status === "approved" ? snipUrls : [],
          collectedAt,
          acceptedAt,
          enteredAt: getEarliest("entered_at"),
          verifiedAt: getEarliest("verified_at"),
          approvedAt: getEarliest("approved_at"),
          dispatchedAt: getEarliest("dispatched_at"),
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

  // Auto-select first patient when entries change
  useEffect(() => {
    if (dispatchEntries.length > 0 && (!selectedPatientId || !dispatchEntries.find(e => e.registration.id === selectedPatientId))) {
      setSelectedPatientId(dispatchEntries[0].registration.id);
    }
  }, [dispatchEntries, selectedPatientId]);

  const selectedEntry = useMemo(() => dispatchEntries.find(e => e.registration.id === selectedPatientId) || null, [dispatchEntries, selectedPatientId]);

  const stats = useMemo(() => ({
    totalPatients: dispatchEntries.length,
    readyToDispatch: dispatchEntries.filter(e => e.completionStatus === "all_done" && e.approvedCount > 0).length,
    partiallyReady: dispatchEntries.filter(e => e.completionStatus === "partial").length,
  }), [dispatchEntries]);

  const dispatchViaWhatsApp = (reg: any) => {
    const phone = (reg.mobile_number || "").replace(/\D/g, "");
    if (!phone) { toast.error("No mobile number available"); return; }
    const message = `Dear ${reg.patient_name},\n\nYour lab reports for Invoice ${reg.invoice_number} are ready.\n\nThank you for choosing PH PathLabs.\nLabLine: 6356 55 66 99`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const markAsDispatched = async (entry: DispatchEntry) => {
    const reg = entry.registration;
    setActionKey(`${reg.id}||dispatch`);
    try {
      const approvedTests = entry.tests.filter(t => t.status === "approved");
      for (const test of approvedTests) {
        await supabase.from("patient_results").update({ status: "dispatched", dispatched_at: new Date().toISOString() } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("status", "approved");
        await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("outsource_status", "approved");
      }
      const stillPending = entry.tests.some(t => t.status !== "approved" && t.status !== "dispatched");
      if (!stillPending) {
        await supabase.from("patient_registrations").update({ status: "dispatched" } as any).eq("id", reg.id);
      }
      toast.success(`Reports dispatched for ${reg.patient_name}`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) { toast.error(err.message || "Dispatch failed"); }
    finally { setActionKey(null); }
  };

  const markTestDispatched = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||dispatch`);
    try {
      await supabase.from("patient_results").update({ status: "dispatched", dispatched_at: new Date().toISOString() } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "approved");
      await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", regId).eq("test_id", testId).eq("outsource_status", "approved");
      toast.success(`${testName} marked as dispatched`);
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
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
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-bold">{stats.totalPatients}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ready</div><div className="text-xl font-bold text-green-600">{stats.readyToDispatch}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Partial</div><div className="text-xl font-bold text-amber-600">{stats.partiallyReady}</div></Card>
      </div>

      {loadingRegs ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : dispatchEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No reports pending dispatch</p>
          <p className="text-sm">All approved reports have been dispatched</p>
        </div>
      ) : (
        <div className="flex gap-3" style={{ height: "calc(100vh - 240px)" }}>
          {/* LEFT PANEL — Patient List */}
          <Card className="w-[380px] shrink-0 flex flex-col overflow-hidden">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search name, mobile, invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {dispatchEntries.map((entry) => {
                  const reg = entry.registration;
                  const isSelected = selectedPatientId === reg.id;
                  return (
                    <div
                      key={reg.id}
                      className={`px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}`}
                      onClick={() => setSelectedPatientId(reg.id)}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1 shrink-0">{getCompletionDot(entry.completionStatus)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {reg.is_stat && <span className="relative flex h-2 w-2 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" /></span>}
                            <span className="font-medium text-sm truncate">{reg.patient_name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{reg.mobile_number}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />{reg.invoice_number}</span>
                            <span className="text-[10px] text-muted-foreground">{entry.approvedCount}A / {entry.pendingCount}P</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(reg.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>

          {/* RIGHT PANEL — Selected Patient Details */}
          <Card className="flex-1 flex flex-col overflow-hidden">
            {selectedEntry ? (
              <>
                {/* Patient header */}
                <div className="p-4 border-b bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <User className="h-5 w-5 text-muted-foreground" />
                        <h3 className="font-semibold text-lg">{selectedEntry.registration.patient_name}</h3>
                        {selectedEntry.registration.is_stat && <Badge variant="destructive" className="text-[10px]">STAT</Badge>}
                        {getCompletionDot(selectedEntry.completionStatus)}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selectedEntry.registration.mobile_number}</span>
                        <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{selectedEntry.registration.invoice_number}</span>
                        {selectedEntry.registration.umr_number && <span>UMR: {selectedEntry.registration.umr_number}</span>}
                        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(selectedEntry.registration.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedEntry.tests.some(t => t.status === "approved" || t.status === "dispatched") && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => openReportSelectDialog(selectedEntry)}>
                            <Eye className="h-4 w-4" /> View Report
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => dispatchViaWhatsApp(selectedEntry.registration)}>
                            <MessageSquare className="h-4 w-4" /> WhatsApp
                          </Button>
                        </>
                      )}
                      {selectedEntry.approvedCount > 0 && (
                        <Button size="sm" className="gap-1" disabled={actionKey === `${selectedEntry.registration.id}||dispatch`} onClick={() => markAsDispatched(selectedEntry)}>
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
                        { label: "Sample Collected", timestamp: test.collectedAt },
                        { label: "Sample Accepted", timestamp: test.acceptedAt },
                        { label: "Results Entered", timestamp: test.enteredAt },
                        { label: "Verified", timestamp: test.verifiedAt },
                        { label: "Approved", timestamp: test.approvedAt },
                        { label: "Dispatched", timestamp: test.dispatchedAt },
                      ];

                      return (
                        <div key={testKey} className="border rounded-lg bg-background">
                          {/* Test header */}
                          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-sm">{test.testName}</span>
                              {getStatusBadge(test.status)}
                            </div>
                            <div className="flex items-center gap-2">
                              {test.status === "approved" && test.snipUrls.length > 0 && (
                                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setViewSnipImages(test.snipUrls)}>
                                  <Eye className="h-3.5 w-3.5" /> Snip ({test.snipUrls.length})
                                </Button>
                              )}
                              {test.status === "approved" && (
                                <>
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => dispatchViaWhatsApp(selectedEntry.registration)}>
                                    <MessageSquare className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" className="h-8 text-xs gap-1" disabled={isTestDispatching} onClick={() => markTestDispatched(selectedEntry.registration.id, test.testId, test.testName)}>
                                    {isTestDispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Dispatch
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Audit trail */}
                          <div className="px-4 py-2.5">
                            <div className="space-y-1">
                              {auditSteps.map((step, idx) => {
                                const isDone = !!step.timestamp;
                                return (
                                  <div key={idx} className="grid grid-cols-[24px_160px_1fr] items-center gap-1 py-0.5">
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
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
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
            <Button className="w-full" disabled={selectedTestIds.size === 0} onClick={handleGenerateReport}>
              <Eye className="h-4 w-4 mr-1" /> Generate Report ({selectedTestIds.size} test{selectedTestIds.size !== 1 ? "s" : ""})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dispatch;
