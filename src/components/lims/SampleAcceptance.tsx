import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, CheckCircle2, RotateCcw, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const TUBE_COLOR_MAP: Record<string, string> = {
  red: "#e53e3e", lavender: "#b794f4", purple: "#9f7aea", yellow: "#ecc94b",
  green: "#48bb78", blue: "#4299e1", grey: "#a0aec0", gray: "#a0aec0",
  white: "#ffffff", orange: "#ed8936", pink: "#ed64a6", black: "#1a202c",
};

interface TubeGroup {
  sampleId: string;
  sampleTube: string;
  tubeColor: string;
  sampleType: string;
  suffix: string;
  testNames: string[];
  testIds: string[];
  testCodes: string[];
  machineIds: string[];
}

const SampleAcceptance = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Reject dialog
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; reg: any }>({ open: false, reg: null });
  const [rejectRemarks, setRejectRemarks] = useState("");

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__saSearchTimeout);
    (window as any).__saSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch sample_collected patients (pending acceptance)
  const { data: pendingRegs = [], isLoading } = useQuery({
    queryKey: ["sample_acceptance_pending", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .eq("status", "sample_collected")
        .eq("bill_cancelled", false)
        .order("updated_at", { ascending: false });
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as any[];
      rows.sort((a: any, b: any) => (b.is_stat ? 1 : 0) - (a.is_stat ? 1 : 0));
      return rows;
    },
  });

  // Fetch accepted patients
  const { data: acceptedRegs = [], isLoading: isLoadingAccepted } = useQuery({
    queryKey: ["sample_acceptance_accepted", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .eq("status", "sample_accepted")
        .eq("bill_cancelled", false)
        .order("updated_at", { ascending: false });
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch tests master
  const { data: testsMap = {} } = useQuery({
    queryKey: ["tests_sample_tube_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, test_name, test_code, sample_tube, tube_color, sample_type, machine_id, machine_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // Fetch parameters with suffix and interfacing info
  const { data: testParamData = {} } = useQuery({
    queryKey: ["test_param_interface_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, report_test_parameters(param_code, parameter_name, custom_sample_suffix_enabled, custom_sample_suffix, send_for_interfacing, machine_id, machine_name, unit)");
      // Build map: test_id -> { suffix, params[] }
      const map: Record<string, { suffix: string; params: any[] }> = {};
      (data || []).forEach((tp: any) => {
        const p = tp.report_test_parameters;
        if (!p || !tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = { suffix: "", params: [] };
        if (p.custom_sample_suffix_enabled && p.custom_sample_suffix) {
          map[tp.test_id].suffix = p.custom_sample_suffix;
        }
        if (p.send_for_interfacing) {
          map[tp.test_id].params.push({
            code: p.param_code,
            name: p.parameter_name,
            machine_id: p.machine_id || "",
            machine_name: p.machine_name || "",
            unit: p.unit || "",
          });
        }
      });
      return map;
    },
  });

  // Build tube groups for display
  const buildTubeGroups = useCallback((reg: any): TubeGroup[] => {
    const tests = (reg.tests || []) as any[];
    const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
    const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));

    const groupMap: Record<string, TubeGroup> = {};
    for (const t of activeTests) {
      const testInfo = testsMap[t.test_id] || {};
      const tube = testInfo.sample_tube || "DEFAULT";
      const tubeColor = testInfo.tube_color || "";
      const sampleType = testInfo.sample_type || "";
      const paramData = testParamData[t.test_id];
      const suffix = paramData?.suffix || "";
      const groupKey = `${tube}||${suffix}`;

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          sampleId: suffix ? `${reg.invoice_number}${suffix}` : reg.invoice_number,
          sampleTube: tube,
          tubeColor,
          sampleType,
          suffix,
          testNames: [],
          testIds: [],
          testCodes: [],
          machineIds: [],
        };
      }
      groupMap[groupKey].testNames.push(t.test_name);
      groupMap[groupKey].testIds.push(t.test_id);
      groupMap[groupKey].testCodes.push(testInfo.test_code || "");
      if (testInfo.machine_id) groupMap[groupKey].machineIds.push(testInfo.machine_id);
    }

    return Object.values(groupMap);
  }, [testsMap, testParamData]);

  // Accept sample → update status + generate LIMS orders
  const acceptMutation = useMutation({
    mutationFn: async (reg: any) => {
      // 1. Update status to sample_accepted
      const { error: updateErr } = await supabase
        .from("patient_registrations")
        .update({ status: "sample_accepted" })
        .eq("id", reg.id);
      if (updateErr) throw updateErr;

      // 2. Generate LIMS test orders per sample/tube group
      const groups = buildTubeGroups(reg);
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const activeTests = ((reg.tests || []) as any[]).filter((t: any) => !cancelledIds.has(t.test_id));

      for (const group of groups) {
        // Build tests array for the order with parameter-level interfacing data
        const orderTests: any[] = [];
        for (const testId of group.testIds) {
          const testInfo = testsMap[testId] || {};
          const paramData = testParamData[testId];

          if (paramData && paramData.params.length > 0) {
            // Add each interfacing parameter as a separate test in the order
            for (const p of paramData.params) {
              orderTests.push({
                code: p.code,
                name: p.name,
                unit: p.unit,
                machine_id: p.machine_id || testInfo.machine_id || "",
                status: "pending",
              });
            }
          } else {
            // Fallback: add test-level entry
            orderTests.push({
              code: testInfo.test_code || "",
              name: testInfo.test_name || activeTests.find((t: any) => t.test_id === testId)?.test_name || "",
              unit: "",
              machine_id: testInfo.machine_id || "",
              status: "pending",
            });
          }
        }

        if (orderTests.length > 0) {
          const { error: orderErr } = await supabase
            .from("lims_test_orders")
            .insert({
              sample_id: group.sampleId,
              patient_name: reg.patient_name,
              tests: orderTests,
              status: "pending",
            });
          if (orderErr) throw orderErr;
        }
      }
    },
    onSuccess: () => {
      toast.success("Sample accepted & LIMS orders generated");
      qc.invalidateQueries({ queryKey: ["sample_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_acceptance_accepted"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to accept sample"),
  });

  // Reject (request repeat collection) → mark as repeat_collection
  const rejectMutation = useMutation({
    mutationFn: async ({ regId, remarks }: { regId: string; remarks: string }) => {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ status: "repeat_collection", remarks: `Repeat Collection: ${remarks}` })
        .eq("id", regId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sample sent back for repeat collection");
      qc.invalidateQueries({ queryKey: ["sample_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
      setRejectDialog({ open: false, reg: null });
      setRejectRemarks("");
    },
    onError: (err: any) => toast.error(err.message || "Failed"),
  });

  const handleReject = () => {
    if (!rejectRemarks.trim()) {
      toast.error("Please provide remarks for repeat collection");
      return;
    }
    rejectMutation.mutate({ regId: rejectDialog.reg.id, remarks: rejectRemarks.trim() });
  };

  const calcAge = (dob: string | null) => {
    if (!dob) return "";
    const birth = new Date(dob);
    return `${new Date().getFullYear() - birth.getFullYear()}`;
  };

  const getTubeColorHex = (colorName: string) => {
    if (!colorName) return "";
    if (colorName.startsWith("#")) return colorName;
    return TUBE_COLOR_MAP[colorName.toLowerCase()] || "";
  };

  const renderTable = (regs: any[], isAccepted: boolean, loading: boolean) => (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : regs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No samples found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Tubes</TableHead>
                <TableHead>Date</TableHead>
                {!isAccepted && <TableHead className="text-right">Actions</TableHead>}
                {isAccepted && <TableHead>Accepted At</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {regs.map((reg: any) => {
                const groups = buildTubeGroups(reg);
                const isExpanded = expandedRow === reg.id;
                return (
                  <>
                    <TableRow
                      key={reg.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedRow(isExpanded ? null : reg.id)}
                    >
                      <TableCell>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-mono font-medium">{reg.invoice_number}</TableCell>
                      <TableCell>
                        <span className="font-medium">{reg.patient_name}</span>
                        {reg.is_stat && (
                          <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{reg.mobile_number}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {groups.map((g, i) => {
                            const hex = getTubeColorHex(g.tubeColor);
                            return (
                              <Badge key={i} variant="outline" className="text-xs gap-1">
                                {hex && (
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full border"
                                    style={{ backgroundColor: hex, borderColor: hex === "#ffffff" ? "#ccc" : hex }}
                                  />
                                )}
                                {g.sampleTube}{g.suffix ? ` (${g.suffix})` : ""}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{format(new Date(reg.updated_at), "dd/MM/yy HH:mm")}</TableCell>
                      {!isAccepted && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              onClick={() => acceptMutation.mutate(reg)}
                              disabled={acceptMutation.isPending}
                            >
                              <ShieldCheck className="h-4 w-4 mr-1" /> Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setRejectDialog({ open: true, reg })}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Repeat
                            </Button>
                          </div>
                        </TableCell>
                      )}
                      {isAccepted && (
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(reg.updated_at), "dd/MM/yy HH:mm")}
                        </TableCell>
                      )}
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${reg.id}-detail`}>
                        <TableCell colSpan={isAccepted ? 7 : 7} className="bg-muted/30 p-4">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Sample Details</div>
                            {groups.map((g, i) => (
                              <div key={i} className="flex items-start gap-3 p-2 bg-background rounded border">
                                <div className="flex items-center gap-2 min-w-[140px]">
                                  {getTubeColorHex(g.tubeColor) && (
                                    <span
                                      className="inline-block w-3 h-3 rounded-full border"
                                      style={{
                                        backgroundColor: getTubeColorHex(g.tubeColor),
                                        borderColor: getTubeColorHex(g.tubeColor) === "#ffffff" ? "#ccc" : getTubeColorHex(g.tubeColor),
                                      }}
                                    />
                                  )}
                                  <span className="font-medium text-sm">{g.sampleTube}</span>
                                  {g.suffix && <Badge variant="secondary" className="text-xs">{g.suffix}</Badge>}
                                </div>
                                <div className="flex-1">
                                  <div className="text-xs text-muted-foreground mb-1">
                                    Sample ID: <span className="font-mono font-medium">{g.sampleId}</span>
                                    {g.sampleType && <> • {g.sampleType}</>}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {g.testNames.map((name, j) => (
                                      <Badge key={j} variant="outline" className="text-xs">{name}</Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                            {reg.remarks && (
                              <div className="text-sm text-muted-foreground mt-1">
                                <span className="font-medium">Remarks:</span> {reg.remarks}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, mobile, invoice…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending Acceptance
            {pendingRegs.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{pendingRegs.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="accepted">
            Accepted
            {acceptedRegs.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{acceptedRegs.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending">{renderTable(pendingRegs, false, isLoading)}</TabsContent>
        <TabsContent value="accepted">{renderTable(acceptedRegs, true, isLoadingAccepted)}</TabsContent>
      </Tabs>

      {/* Reject / Repeat Collection Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => { if (!o) { setRejectDialog({ open: false, reg: null }); setRejectRemarks(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Repeat Collection</DialogTitle>
            <DialogDescription>
              Patient: <strong>{rejectDialog.reg?.patient_name}</strong> ({rejectDialog.reg?.invoice_number})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
              <AlertTriangle className="h-4 w-4" />
              Sample will be sent back for re-collection. Status will revert to "Registered".
            </div>
            <Textarea
              placeholder="Enter reason for repeat collection (e.g., hemolyzed, clotted, insufficient quantity)…"
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialog({ open: false, reg: null }); setRejectRemarks(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectMutation.isPending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Confirm Repeat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SampleAcceptance;
