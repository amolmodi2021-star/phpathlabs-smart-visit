import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, ShieldCheck, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, ScanBarcode } from "lucide-react";
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
  // Per-tube selection: key = `${regId}||${sampleId}`
  const [selectedTubes, setSelectedTubes] = useState<Set<string>>(new Set());

  // Reject dialog — can be for specific tubes
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; reg: any; tubeKeys: string[] }>({ open: false, reg: null, tubeKeys: [] });
  const [rejectRemarks, setRejectRemarks] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

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

  // Fetch parameters with suffix and interfacing info — FIXED column name: send_for_interface
  const { data: testParamData = {} } = useQuery({
    queryKey: ["test_param_interface_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, report_test_parameters(param_code, parameter_name, custom_sample_suffix_enabled, custom_sample_suffix, send_for_interface, machine_id, machine_name, unit)");
      const map: Record<string, { suffix: string; params: any[] }> = {};
      (data || []).forEach((tp: any) => {
        const p = tp.report_test_parameters;
        if (!p || !tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = { suffix: "", params: [] };
        if (p.custom_sample_suffix_enabled && p.custom_sample_suffix) {
          map[tp.test_id].suffix = p.custom_sample_suffix;
        }
        if (p.send_for_interface) {
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

  // Build tube groups for a registration
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

  // Build a map of all sample IDs across pending regs for barcode scanning
  const sampleIdToRegMap = useCallback((): Record<string, { reg: any; tubeKey: string; group: TubeGroup }> => {
    const map: Record<string, { reg: any; tubeKey: string; group: TubeGroup }> = {};
    for (const reg of pendingRegs) {
      const groups = buildTubeGroups(reg);
      for (const g of groups) {
        const key = `${reg.id}||${g.sampleId}`;
        map[g.sampleId] = { reg, tubeKey: key, group: g };
      }
    }
    return map;
  }, [pendingRegs, buildTubeGroups]);

  // Toggle tube selection
  const toggleTube = (key: string) => {
    setSelectedTubes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Toggle all tubes for a registration
  const toggleAllForReg = (reg: any) => {
    const groups = buildTubeGroups(reg);
    const keys = groups.map(g => `${reg.id}||${g.sampleId}`);
    setSelectedTubes(prev => {
      const next = new Set(prev);
      const allSelected = keys.every(k => next.has(k));
      if (allSelected) {
        keys.forEach(k => next.delete(k));
      } else {
        keys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  // Accept selected tubes for a patient
  const acceptMutation = useMutation({
    mutationFn: async ({ reg, acceptedSampleIds }: { reg: any; acceptedSampleIds: string[] }) => {
      const groups = buildTubeGroups(reg);
      const acceptedGroups = groups.filter(g => acceptedSampleIds.includes(g.sampleId));
      const allGroupsAccepted = acceptedGroups.length === groups.length;

      // Generate LIMS orders for accepted groups
      for (const group of acceptedGroups) {
        const orderTests: any[] = [];
        for (const testId of group.testIds) {
          const testInfo = testsMap[testId] || {};
          const paramData = testParamData[testId];
          if (paramData && paramData.params.length > 0) {
            for (const p of paramData.params) {
              orderTests.push({
                code: p.code, name: p.name, unit: p.unit,
                machine_id: p.machine_id || testInfo.machine_id || "",
                status: "pending",
              });
            }
          } else {
            orderTests.push({
              code: testInfo.test_code || "", name: testInfo.test_name || group.testNames[0] || "",
              unit: "", machine_id: testInfo.machine_id || "", status: "pending",
            });
          }
        }
        if (orderTests.length > 0) {
          const { error } = await supabase.from("lims_test_orders").insert({
            sample_id: group.sampleId, patient_name: reg.patient_name,
            tests: orderTests, status: "pending",
          });
          if (error) throw error;
        }
      }

      // If all groups accepted, update patient status
      if (allGroupsAccepted) {
        const { error } = await supabase
          .from("patient_registrations")
          .update({ status: "sample_accepted" })
          .eq("id", reg.id);
        if (error) throw error;
      }
    },
    onSuccess: (_, { acceptedSampleIds }) => {
      toast.success(`${acceptedSampleIds.length} sample(s) accepted & LIMS orders generated`);
      setSelectedTubes(new Set());
      qc.invalidateQueries({ queryKey: ["sample_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_acceptance_accepted"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to accept"),
  });

  // Reject selected tubes
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
      setSelectedTubes(new Set());
      qc.invalidateQueries({ queryKey: ["sample_acceptance_pending"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
      setRejectDialog({ open: false, reg: null, tubeKeys: [] });
      setRejectRemarks("");
    },
    onError: (err: any) => toast.error(err.message || "Failed"),
  });

  const handleReject = () => {
    if (!rejectRemarks.trim()) { toast.error("Please provide remarks"); return; }
    rejectMutation.mutate({ regId: rejectDialog.reg.id, remarks: rejectRemarks.trim() });
  };

  // Accept all selected tubes across registrations
  const handleAcceptSelected = () => {
    if (selectedTubes.size === 0) { toast.error("Select at least one sample tube"); return; }
    // Group by regId
    const regMap: Record<string, string[]> = {};
    selectedTubes.forEach(key => {
      const [regId, sampleId] = key.split("||");
      if (!regMap[regId]) regMap[regId] = [];
      regMap[regId].push(sampleId);
    });
    for (const regId of Object.keys(regMap)) {
      const reg = pendingRegs.find((r: any) => r.id === regId);
      if (reg) acceptMutation.mutate({ reg, acceptedSampleIds: regMap[regId] });
    }
  };

  // Reject selected tubes
  const handleRejectSelected = () => {
    if (selectedTubes.size === 0) { toast.error("Select at least one sample tube"); return; }
    // For rejection, set to repeat for the patient (all tubes affected)
    const regIds = new Set<string>();
    const tubeKeys: string[] = [];
    selectedTubes.forEach(key => { regIds.add(key.split("||")[0]); tubeKeys.push(key); });
    if (regIds.size > 1) { toast.error("Select tubes from one patient at a time for repeat"); return; }
    const regId = [...regIds][0];
    const reg = pendingRegs.find((r: any) => r.id === regId);
    if (reg) setRejectDialog({ open: true, reg, tubeKeys });
  };

  // Barcode scan: when search matches a sample ID exactly, auto-accept it
  useEffect(() => {
    if (!search.trim()) return;
    const trimmed = search.trim().toUpperCase();
    const map = sampleIdToRegMap();
    // Check exact match with sample ID (with or without suffix)
    const match = map[trimmed];
    if (match) {
      // Auto accept this tube
      acceptMutation.mutate({ reg: match.reg, acceptedSampleIds: [match.group.sampleId] });
      setSearch("");
      setDebouncedSearch("");
      toast.info(`Scanned: ${match.group.sampleId} → Accepting…`);
    }
  }, [debouncedSearch]);

  const getTubeColorHex = (colorName: string) => {
    if (!colorName) return "";
    if (colorName.startsWith("#")) return colorName;
    return TUBE_COLOR_MAP[colorName.toLowerCase()] || "";
  };

  const renderTable = (regs: any[], isAccepted: boolean, loading: boolean) => {
    const hasSelected = selectedTubes.size > 0;
    return (
      <Card>
        <CardContent className="p-0">
          {!isAccepted && hasSelected && (
            <div className="flex items-center gap-2 p-3 bg-muted/50 border-b">
              <Badge variant="secondary">{selectedTubes.size} tube(s) selected</Badge>
              <Button size="sm" onClick={handleAcceptSelected} disabled={acceptMutation.isPending}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Accept Selected
              </Button>
              <Button size="sm" variant="destructive" onClick={handleRejectSelected}>
                <RotateCcw className="h-4 w-4 mr-1" /> Repeat Selected
              </Button>
            </div>
          )}
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : regs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No samples found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  {!isAccepted && <TableHead className="w-10"></TableHead>}
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
                {regs.filter((reg: any) => {
                  const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
                  return ((reg.tests || []) as any[]).some((t: any) => !cancelledIds.has(t.test_id));
                }).map((reg: any) => {
                  const groups = buildTubeGroups(reg);
                  const isExpanded = expandedRow === reg.id;
                  const allKeys = groups.map(g => `${reg.id}||${g.sampleId}`);
                  const allSelected = allKeys.length > 0 && allKeys.every(k => selectedTubes.has(k));
                  const someSelected = allKeys.some(k => selectedTubes.has(k));
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
                        {!isAccepted && (
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={() => toggleAllForReg(reg)}
                              className={someSelected && !allSelected ? "data-[state=unchecked]:bg-primary/30" : ""}
                            />
                          </TableCell>
                        )}
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
                                    <span className="inline-block w-2.5 h-2.5 rounded-full border"
                                      style={{ backgroundColor: hex, borderColor: hex === "#ffffff" ? "#ccc" : hex }} />
                                  )}
                                  {g.sampleTube}{g.suffix ? ` (${g.suffix})` : ""}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{format(new Date(reg.updated_at), "dd/MM/yy HH:mm")}</TableCell>
                        {!isAccepted && (
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" onClick={() => {
                                const sampleIds = groups.map(g => g.sampleId);
                                acceptMutation.mutate({ reg, acceptedSampleIds: sampleIds });
                              }} disabled={acceptMutation.isPending}>
                                <ShieldCheck className="h-4 w-4 mr-1" /> Accept All
                              </Button>
                              <Button size="sm" variant="destructive"
                                onClick={() => setRejectDialog({ open: true, reg, tubeKeys: allKeys })}>
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
                          <TableCell colSpan={isAccepted ? 7 : 8} className="bg-muted/30 p-4">
                            <div className="space-y-2">
                              <div className="text-sm font-medium">Sample Details</div>
                              {groups.map((g, i) => {
                                const tubeKey = `${reg.id}||${g.sampleId}`;
                                const isChecked = selectedTubes.has(tubeKey);
                                return (
                                  <div key={i} className="flex items-start gap-3 p-2 bg-background rounded border">
                                    {!isAccepted && (
                                      <div className="pt-1">
                                        <Checkbox checked={isChecked} onCheckedChange={() => toggleTube(tubeKey)} />
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 min-w-[140px]">
                                      {getTubeColorHex(g.tubeColor) && (
                                        <span className="inline-block w-3 h-3 rounded-full border"
                                          style={{
                                            backgroundColor: getTubeColorHex(g.tubeColor),
                                            borderColor: getTubeColorHex(g.tubeColor) === "#ffffff" ? "#ccc" : getTubeColorHex(g.tubeColor),
                                          }} />
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
                                    {!isAccepted && (
                                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                        <Button size="sm" variant="outline" className="h-7 text-xs"
                                          onClick={() => acceptMutation.mutate({ reg, acceptedSampleIds: [g.sampleId] })}
                                          disabled={acceptMutation.isPending}>
                                          <ShieldCheck className="h-3 w-3 mr-1" /> Accept
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/50"
                                          onClick={() => setRejectDialog({ open: true, reg, tubeKeys: [tubeKey] })}>
                                          <RotateCcw className="h-3 w-3 mr-1" /> Repeat
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
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
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Scan barcode or search by name, mobile, invoice…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
          <ScanBarcode className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
      <Dialog open={rejectDialog.open} onOpenChange={(o) => { if (!o) { setRejectDialog({ open: false, reg: null, tubeKeys: [] }); setRejectRemarks(""); } }}>
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
              Sample will be sent back for re-collection.
            </div>
            <Textarea
              placeholder="Enter reason for repeat collection (e.g., hemolyzed, clotted, insufficient quantity)…"
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialog({ open: false, reg: null, tubeKeys: [] }); setRejectRemarks(""); }}>
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
