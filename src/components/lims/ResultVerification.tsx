import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, CheckCircle2, ChevronDown, ChevronUp, Loader2, Image as ImageIcon, FlaskConical, ClipboardCheck } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const ResultVerification = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch registrations with status entered or sample_accepted (which may have entered results)
  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["verification_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .in("status", ["sample_accepted", "entered"])
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const regIds = registrations.map((r: any) => r.id);

  // Fetch entered patient_results
  const { data: enteredResults = [] } = useQuery({
    queryKey: ["verification_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_results")
        .select("*")
        .in("registration_id", regIds)
        .eq("status", "entered");
      return (data || []) as any[];
    },
  });

  // Fetch outsourced snips with results_entered status
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["verification_outsourced", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("outsourced_test_snips")
        .select("*")
        .in("registration_id", regIds)
        .eq("outsource_status", "results_entered");
      return (data || []) as any[];
    },
  });

  // Fetch tests master
  const { data: testsMap = {} } = useQuery({
    queryKey: ["verification_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // Build verification entries: patients who have at least one entered result or outsourced snip
  const verificationEntries = useMemo(() => {
    return registrations
      .map((reg: any) => {
        const tests = (reg.tests || []) as any[];
        const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
        const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));

        // Group entered results by test
        const manualTests: Record<string, any[]> = {};
        enteredResults
          .filter((r: any) => r.registration_id === reg.id)
          .forEach((r: any) => {
            if (!manualTests[r.test_id]) manualTests[r.test_id] = [];
            manualTests[r.test_id].push(r);
          });

        // Outsourced snips for this reg
        const snips = outsourcedSnips.filter((s: any) => s.registration_id === reg.id);

        const verifiableTests: any[] = [];
        for (const t of activeTests) {
          const testInfo = testsMap[t.test_id] || {};
          const manualResults = manualTests[t.test_id];
          const snip = snips.find((s: any) => s.test_id === t.test_id);

          if (manualResults && manualResults.length > 0) {
            verifiableTests.push({
              testId: t.test_id,
              testName: t.test_name || testInfo.test_name || "Unknown",
              type: "manual",
              results: manualResults,
              snip: null,
            });
          } else if (snip) {
            verifiableTests.push({
              testId: t.test_id,
              testName: t.test_name || testInfo.test_name || "Unknown",
              type: "snip",
              results: [],
              snip,
            });
          }
        }

        if (verifiableTests.length === 0) return null;
        return { registration: reg, tests: verifiableTests };
      })
      .filter(Boolean) as any[];
  }, [registrations, enteredResults, outsourcedSnips, testsMap]);

  // Stats
  const totalPatients = verificationEntries.length;
  const totalTests = verificationEntries.reduce((sum: number, e: any) => sum + e.tests.length, 0);

  // Verify a single test
  const verifyTest = async (regId: string, testId: string, type: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setVerifyingKey(key);
    try {
      if (type === "manual") {
        // Update patient_results status to verified
        await supabase
          .from("patient_results")
          .update({ status: "verified" } as any)
          .eq("registration_id", regId)
          .eq("test_id", testId)
          .eq("status", "entered");
      }
      if (type === "snip") {
        // Update outsourced_test_snips status
        await supabase
          .from("outsourced_test_snips")
          .update({ outsource_status: "verified" } as any)
          .eq("registration_id", regId)
          .eq("test_id", testId);
      }

      toast.success(`${testName} verified`);
      qc.invalidateQueries({ queryKey: ["verification_results"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  // Verify all tests for a patient
  const verifyAllForPatient = async (entry: any) => {
    const regId = entry.registration.id;
    setVerifyingKey(regId);
    try {
      // Verify all manual results
      await supabase
        .from("patient_results")
        .update({ status: "verified" } as any)
        .eq("registration_id", regId)
        .eq("status", "entered");

      // Verify all outsourced snips
      await supabase
        .from("outsourced_test_snips")
        .update({ outsource_status: "verified" } as any)
        .eq("registration_id", regId)
        .eq("outsource_status", "results_entered");

      toast.success(`All tests verified for ${entry.registration.patient_name}`);
      qc.invalidateQueries({ queryKey: ["verification_results"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Patients Pending Verification</div>
          <div className="text-xl font-bold">{totalPatients}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Tests to Verify</div>
          <div className="text-xl font-bold">{totalTests}</div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, mobile, invoice..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loadingRegs ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : verificationEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No results pending verification</p>
          <p className="text-sm">All entered results have been verified</p>
        </div>
      ) : (
        <div className="space-y-2">
          {verificationEntries.map((entry: any) => {
            const reg = entry.registration;
            const isExpanded = expandedPatient === reg.id;
            const isVerifying = verifyingKey === reg.id;

            return (
              <Card key={reg.id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {reg.is_stat && (
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        {reg.patient_name}
                        <span className="text-xs text-muted-foreground ml-2">{reg.invoice_number}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {reg.mobile_number} • {reg.gender} • {entry.tests.length} test{entry.tests.length > 1 ? "s" : ""} to verify
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      disabled={isVerifying}
                      onClick={(e) => {
                        e.stopPropagation();
                        verifyAllForPatient(entry);
                      }}
                    >
                      {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      Verify All
                    </Button>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-muted/10">
                    {entry.tests.map((test: any) => {
                      const testKey = `${reg.id}||${test.testId}`;
                      const isTestVerifying = verifyingKey === testKey;

                      return (
                        <div key={testKey} className="border rounded-lg overflow-hidden bg-background">
                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              {test.type === "snip" ? (
                                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <FlaskConical className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="font-medium text-sm">{test.testName}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {test.type === "snip" ? "Outsourced / Snip" : "Manual Entry"}
                              </Badge>
                              {test.snip?.outsourced_lab_name && (
                                <span className="text-[10px] text-muted-foreground">
                                  Lab: {test.snip.outsourced_lab_name}
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={isTestVerifying}
                              onClick={() => verifyTest(reg.id, test.testId, test.type, test.testName)}
                            >
                              {isTestVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                              Verify
                            </Button>
                          </div>

                          {/* Show results for manual entry */}
                          {test.type === "manual" && test.results.length > 0 && (
                            <div className="px-3 pb-2">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs py-1">Parameter</TableHead>
                                    <TableHead className="text-xs py-1">Result</TableHead>
                                    <TableHead className="text-xs py-1">Unit</TableHead>
                                    <TableHead className="text-xs py-1">Ref. Range</TableHead>
                                    <TableHead className="text-xs py-1">Flag</TableHead>
                                  </TableRow>
                                </TableHeader>
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
                                        {r.flag === "N" && <Badge variant="outline" className="text-[10px] px-1">N</Badge>}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}

                          {/* Show snip images for outsourced */}
                          {test.type === "snip" && test.snip?.snip_image_urls && (
                            <div className="px-3 pb-2 space-y-2">
                              {(test.snip.snip_image_urls as string[]).map((url: string, idx: number) => (
                                <div key={idx} className="border rounded overflow-hidden">
                                  <img
                                    src={url}
                                    alt={`Snip page ${idx + 1}`}
                                    className="w-full max-h-[300px] object-contain cursor-pointer"
                                    onClick={() => window.open(url, "_blank")}
                                  />
                                </div>
                              ))}
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
    </div>
  );
};

export default ResultVerification;
