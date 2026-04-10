import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronDown, ChevronUp, Loader2, CheckCircle2, Send, Eye, Truck, MessageSquare, Circle } from "lucide-react";
import { toast } from "sonner";

type TestStatus = "registered" | "sample_collected" | "sample_accepted" | "results_entered" | "verified" | "approved" | "dispatched";

interface DispatchTest {
  testId: string;
  testName: string;
  status: TestStatus;
  results: any[];
  snipUrls: string[];
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
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);

  // Fetch all non-cancelled registrations
  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["dispatch_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("*")
        .or("status.in.(sample_accepted,entered,verified,approved,dispatched),accepted_samples.neq.[]")
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const regIds = registrations.map((r: any) => r.id);

  // Fetch ALL results (not just approved)
  const { data: allResults = [] } = useQuery({
    queryKey: ["dispatch_all_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  // Fetch ALL outsourced snips
  const { data: allSnips = [] } = useQuery({
    queryKey: ["dispatch_all_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  // Fetch held report registration IDs
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

  // Build dispatch entries with per-test status
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

        // Determine granular test status
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
        if (hasDispatchedResults || hasDispatchedSnip) {
          status = "dispatched";
        } else if (hasApprovedResults || hasApprovedSnip) {
          status = "approved";
        } else if (hasVerifiedResults || hasVerifiedSnip) {
          status = "verified";
        } else if (hasEnteredResults || hasEnteredSnip) {
          status = "results_entered";
        } else if (regStatus === "sample_accepted" || testResults.length > 0) {
          status = "sample_accepted";
        } else if (regStatus === "sample_collected") {
          status = "sample_collected";
        }

        const snipUrls = snip && snip.result_mode === "snip" && Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls : [];
        const approvedResults = testResults.filter((r: any) => r.status === "approved");

        dispatchTests.push({
          testId: t.test_id,
          testName: t.test_name || testInfo.test_name || "Unknown",
          status,
          results: approvedResults,
          snipUrls: status === "approved" ? snipUrls : [],
        });
      }

      const approvedCount = dispatchTests.filter(t => t.status === "approved").length;
      const pendingCount = dispatchTests.filter(t => t.status !== "approved" && t.status !== "dispatched").length;
      const nonDispatchedCount = approvedCount + pendingCount;

      let completionStatus: "all_done" | "partial" | "all_pending" = "all_pending";
      if (nonDispatchedCount === 0) {
        // All dispatched already — treat as all_done
        completionStatus = "all_done";
      } else if (pendingCount === 0) {
        completionStatus = "all_done";
      } else if (approvedCount > 0) {
        completionStatus = "partial";
      }

      return { registration: reg, tests: dispatchTests, completionStatus, approvedCount, pendingCount } as DispatchEntry;
    }).filter(Boolean) as DispatchEntry[];
  }, [registrations, allResults, allSnips, testsMap, heldSet]);

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
        await supabase.from("patient_results").update({ status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("status", "approved");
        await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", test.testId).eq("outsource_status", "approved");
      }
      // Only update registration status if all tests are now dispatched
      const stillPending = entry.tests.some(t => t.status !== "approved" && t.status !== "dispatched");
      if (!stillPending) {
        await supabase.from("patient_registrations").update({ status: "dispatched" } as any).eq("id", reg.id);
      }
      toast.success(`Reports dispatched for ${reg.patient_name}`);
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) { toast.error(err.message || "Dispatch failed"); }
    finally { setActionKey(null); }
  };

  const markTestDispatched = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||dispatch`);
    try {
      await supabase.from("patient_results").update({ status: "dispatched" } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "approved");
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
      case "sample_collected": return <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600">Sample Collected</Badge>;
      case "sample_accepted": return <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-700">Sample Accepted</Badge>;
      case "results_entered": return <Badge className="text-[10px] bg-indigo-500">Results Entered</Badge>;
      case "verified": return <Badge className="text-[10px] bg-purple-600">Verified</Badge>;
      case "approved": return <Badge className="text-[10px] bg-green-600">Approved</Badge>;
      case "dispatched": return <Badge className="text-[10px] bg-blue-600">Dispatched</Badge>;
    }
  };

  const getCompletionDot = (status: "all_done" | "partial" | "all_pending") => {
    switch (status) {
      case "all_done": return <Circle className="h-4 w-4 fill-green-500 text-green-500" />;
      case "partial": return <Circle className="h-4 w-4 fill-amber-500 text-amber-500" />;
      case "all_pending": return <Circle className="h-4 w-4 fill-red-500 text-red-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, mobile, invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Patients</div><div className="text-xl font-bold">{stats.totalPatients}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ready to Dispatch</div><div className="text-xl font-bold text-green-600">{stats.readyToDispatch}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Partially Ready</div><div className="text-xl font-bold text-amber-600">{stats.partiallyReady}</div></Card>
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
        <div className="space-y-2">
          {dispatchEntries.map((entry) => {
            const reg = entry.registration;
            const isExpanded = expandedPatient === reg.id;
            const isDispatching = actionKey === `${reg.id}||dispatch`;
            const hasApproved = entry.approvedCount > 0;
            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-4 flex justify-center shrink-0">{getCompletionDot(entry.completionStatus)}</div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    {reg.is_stat && <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{reg.patient_name}{!["sample_accepted","entered","verified","approved","dispatched"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && <Badge className="bg-amber-100 text-amber-700 text-[10px] ml-1">PARTIAL</Badge>}<span className="text-xs text-muted-foreground ml-2">{reg.invoice_number}</span></div>
                      <div className="text-xs text-muted-foreground">
                        {reg.mobile_number} • {entry.approvedCount} approved, {entry.pendingCount} pending
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {entry.completionStatus !== "all_pending" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); navigate(`/lims/report/${reg.id}`); }}>
                          <Eye className="h-3.5 w-3.5" /> View Report
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); dispatchViaWhatsApp(reg); }}>
                          <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                        </Button>
                      </>
                    )}
                    {hasApproved && (
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={isDispatching} onClick={(e) => { e.stopPropagation(); markAsDispatched(entry); }}>
                        {isDispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Dispatch All
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-muted/10">
                    {entry.tests.map((test) => {
                      const testKey = `${reg.id}||${test.testId}`;
                      const isTestDispatching = actionKey === `${testKey}||dispatch`;
                      return (
                        <div key={testKey} className="border rounded-lg overflow-hidden bg-background">
                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{test.testName}</span>
                              {getStatusBadge(test.status)}
                            </div>
                            <div className="flex items-center gap-1">
                              {test.status === "approved" && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => dispatchViaWhatsApp(reg)}>
                                    <MessageSquare className="h-3 w-3" /> WhatsApp
                                  </Button>
                                  <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={isTestDispatching} onClick={() => markTestDispatched(reg.id, test.testId, test.testName)}>
                                    {isTestDispatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Mark Dispatched
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {test.status === "approved" && test.snipUrls.length > 0 && (
                            <div className="px-3 pb-2">
                              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setViewSnipImages(test.snipUrls)}>
                                <Eye className="h-3 w-3" /> View Outsourced Report ({test.snipUrls.length} page{test.snipUrls.length > 1 ? "s" : ""})
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!viewSnipImages} onOpenChange={open => { if (!open) setViewSnipImages(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outsourced Result — Snipped Images</DialogTitle></DialogHeader>
          <div className="space-y-4">{viewSnipImages?.map((url, idx) => (<div key={idx} className="border rounded-lg overflow-hidden"><img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" /></div>))}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dispatch;
