import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronDown, ChevronUp, Loader2, CheckCircle2, Send, Eye, Truck, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const Dispatch = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);

  // Fetch registrations that have approved results
  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["dispatch_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("*")
        .in("status", ["sample_accepted", "entered", "verified", "approved"])
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const regIds = registrations.map((r: any) => r.id);

  // Fetch approved results
  const { data: approvedResults = [] } = useQuery({
    queryKey: ["dispatch_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds).eq("status", "approved");
      return (data || []) as any[];
    },
  });

  // Fetch outsourced snips
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["dispatch_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls").in("registration_id", regIds);
      return (data || []) as any[];
    },
  });

  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => { const { data } = await supabase.from("tests").select("id, test_name"); const map: Record<string, any> = {}; (data || []).forEach((t: any) => { map[t.id] = t; }); return map; },
  });

  // Build dispatch entries
  const dispatchEntries = useMemo(() => {
    return registrations.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));

      const approvedTests: { testId: string; testName: string; results: any[]; snipUrls: string[] }[] = [];
      for (const t of activeTests) {
        const testInfo = testsMap[t.test_id] || {};
        const testResults = approvedResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
        const snip = outsourcedSnips.find((s: any) => s.registration_id === reg.id && s.test_id === t.test_id && s.outsource_status === "approved");
        if (testResults.length === 0 && !snip) continue;
        const snipUrls = snip && snip.result_mode === "snip" && Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls : [];
        approvedTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "Unknown", results: testResults, snipUrls });
      }

      if (approvedTests.length === 0) return null;
      return { registration: reg, tests: approvedTests };
    }).filter(Boolean) as any[];
  }, [registrations, approvedResults, outsourcedSnips, testsMap]);

  const stats = useMemo(() => ({
    totalPatients: dispatchEntries.length,
    totalTests: dispatchEntries.reduce((s: number, e: any) => s + e.tests.length, 0),
  }), [dispatchEntries]);

  // Dispatch via WhatsApp
  const dispatchViaWhatsApp = (reg: any) => {
    const phone = (reg.mobile_number || "").replace(/\D/g, "");
    if (!phone) { toast.error("No mobile number available"); return; }
    const message = `Dear ${reg.patient_name},\n\nYour lab reports for Invoice ${reg.invoice_number} are ready.\n\nThank you for choosing PH PathLabs.\nLabLine: 6356 55 66 99`;
    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  // Mark as dispatched
  const markAsDispatched = async (entry: any) => {
    const reg = entry.registration;
    setActionKey(`${reg.id}||dispatch`);
    try {
      const testIds = entry.tests.map((t: any) => t.testId);
      // Update all approved results to dispatched
      for (const testId of testIds) {
        await supabase.from("patient_results").update({ status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("status", "approved");
        await supabase.from("outsourced_test_snips").update({ outsource_status: "dispatched" } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("outsource_status", "approved");
      }
      // Update registration status
      await supabase.from("patient_registrations").update({ status: "dispatched" } as any).eq("id", reg.id);
      toast.success(`Reports dispatched for ${reg.patient_name}`);
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) { toast.error(err.message || "Dispatch failed"); }
    finally { setActionKey(null); }
  };

  // Mark single test as dispatched
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

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, mobile, invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Patients Ready for Dispatch</div><div className="text-xl font-bold">{stats.totalPatients}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Tests to Dispatch</div><div className="text-xl font-bold">{stats.totalTests}</div></Card>
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
          {dispatchEntries.map((entry: any) => {
            const reg = entry.registration;
            const isExpanded = expandedPatient === reg.id;
            const isDispatching = actionKey === `${reg.id}||dispatch`;
            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    {reg.is_stat && <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{reg.patient_name}<span className="text-xs text-muted-foreground ml-2">{reg.invoice_number}</span></div>
                      <div className="text-xs text-muted-foreground">{reg.mobile_number} • {entry.tests.length} test{entry.tests.length > 1 ? "s" : ""} approved</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); dispatchViaWhatsApp(reg); }}>
                      <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                    </Button>
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={isDispatching} onClick={(e) => { e.stopPropagation(); markAsDispatched(entry); }}>
                      {isDispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Dispatch All
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-muted/10">
                    {entry.tests.map((test: any) => {
                      const testKey = `${reg.id}||${test.testId}`;
                      const isTestDispatching = actionKey === `${testKey}||dispatch`;
                      return (
                        <div key={testKey} className="border rounded-lg overflow-hidden bg-background">
                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{test.testName}</span>
                              <Badge className="text-[10px] bg-green-600">Approved</Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { dispatchViaWhatsApp(reg); }}>
                                <MessageSquare className="h-3 w-3" /> WhatsApp
                              </Button>
                              <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={isTestDispatching} onClick={() => markTestDispatched(reg.id, test.testId, test.testName)}>
                                {isTestDispatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Mark Dispatched
                              </Button>
                            </div>
                          </div>

                          {/* Results summary */}
                          {test.results.length > 0 && (
                            <div className="px-3 pb-2">
                              <Table>
                                <TableHeader><TableRow>
                                  <TableHead className="text-xs py-1">Parameter</TableHead>
                                  <TableHead className="text-xs py-1">Result</TableHead>
                                  <TableHead className="text-xs py-1">Unit</TableHead>
                                  <TableHead className="text-xs py-1">Ref. Range</TableHead>
                                  <TableHead className="text-xs py-1">Flag</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                  {test.results.map((r: any) => (
                                    <TableRow key={r.id}>
                                      <TableCell className="py-1 text-sm">{r.parameter_name}</TableCell>
                                      <TableCell className="py-1 text-sm font-medium">{r.result_value}</TableCell>
                                      <TableCell className="py-1 text-xs text-muted-foreground">{r.unit}</TableCell>
                                      <TableCell className="py-1 text-xs text-muted-foreground">{r.reference_range}</TableCell>
                                      <TableCell className="py-1">
                                        {r.flag === "H" && <Badge variant="destructive" className="text-[10px] px-1">H</Badge>}
                                        {r.flag === "L" && <Badge className="text-[10px] px-1 bg-amber-500">L</Badge>}
                                        {r.flag === "A" && <Badge variant="destructive" className="text-[10px] px-1">A</Badge>}
                                        {r.flag === "N" && <Badge variant="outline" className="text-[10px] px-1">N</Badge>}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}

                          {/* Snip images */}
                          {test.snipUrls.length > 0 && (
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
