import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import { Search, ShieldCheck, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, ScanBarcode, Printer } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatAgeGender } from "@/lib/ageGender";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { printBarcodes } from "@/lib/barcodePrint";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import NewBadge from "./NewBadge";

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
  accepted_at: string | null;
  created_at: string;
}

interface GroupedRegistration {
  registration: any;
  tubes: SampleTubeRow[];
}

const ACCEPTED_PAGE_SIZE = 50;

const SampleAcceptance = () => {
  const qc = useQueryClient();
  useLimsPipelineRealtime("sample_acceptance");
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  /** Off by default (30-day window). On = all collected tubes still awaiting acceptance. */
  const [showOlderPending, setShowOlderPending] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedTubes, setSelectedTubes] = useState<Set<string>>(new Set());
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; reg: any; tubeIds: string[] }>({ open: false, reg: null, tubeIds: [] });
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [acceptedLimit, setAcceptedLimit] = useState(ACCEPTED_PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__saSearchTimeout);
    (window as any).__saSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Reset accepted lazy-load window whenever search or tab changes
  useEffect(() => { setAcceptedLimit(ACCEPTED_PAGE_SIZE); }, [debouncedSearch, activeTab]);


  // Fetch collected tubes (pending acceptance).
  // Default: last 30 days. Optional: include older backlog still awaiting acceptance.
  const { data: collectedTubes = [], isLoading } = useQuery({
    queryKey: ["sample_tubes_acceptance_pending", showOlderPending],
    queryFn: async () => {
      let q = supabase
        .from("sample_tubes" as any)
        .select("id, sample_uid, registration_id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status, collected_at, accepted_at, created_at")
        .eq("status", "collected")
        .order("created_at", { ascending: false })
        .limit(showOlderPending ? 2000 : 500);
      if (!showOlderPending) {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        q = q.gte("created_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as SampleTubeRow[];
    },
    staleTime: 30_000,
  });

  // Fetch accepted tubes (for accepted tab) — recent window + hard cap
  const { data: acceptedTubes = [], isLoading: isLoadingAccepted } = useQuery({
    queryKey: ["sample_tubes_acceptance_accepted"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase
        .from("sample_tubes" as any)
        .select("id, sample_uid, registration_id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status, collected_at, accepted_at, created_at")
        .eq("status", "accepted")
        .gte("accepted_at", since.toISOString())
        .order("accepted_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as SampleTubeRow[];
    },
    staleTime: 30_000,
  });

  // Build ordered, deduped accepted registration IDs (newest acceptance first),
  // then slice to the lazy-loaded window. This is what we'll request from the
  // (heavier) registrations table — keeps cloud cost proportional to what's shown.
  const acceptedRegIdsOrdered = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of acceptedTubes) {
      if (!seen.has(t.registration_id)) {
        seen.add(t.registration_id);
        out.push(t.registration_id);
      }
    }
    return out;
  }, [acceptedTubes]);

  const visibleAcceptedRegIds = useMemo(
    () => acceptedRegIdsOrdered.slice(0, acceptedLimit),
    [acceptedRegIdsOrdered, acceptedLimit]
  );
  const totalAcceptedCount = acceptedRegIdsOrdered.length;
  const hasMoreAccepted = totalAcceptedCount > acceptedLimit;

  // Pending always loads in full (it's already a small working queue).
  const pendingRegIds = useMemo(
    () => [...new Set(collectedTubes.map(t => t.registration_id))],
    [collectedTubes]
  );

  // Registrations we actually need to fetch = pending + visible accepted slice.
  const regIds = useMemo(
    () => [...new Set([...pendingRegIds, ...visibleAcceptedRegIds])],
    [pendingRegIds, visibleAcceptedRegIds]
  );

  // Fetch registrations (only for IDs we need to display). Exclude fully
  // dispatched / cancelled records — they should never appear in this stage.
  const { data: registrations = [] } = useQuery({
    queryKey: ["sample_acceptance_regs", regIds.join(","), debouncedSearch],
    enabled: regIds.length > 0,
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .in("id", regIds)
        .eq("bill_cancelled", false)
        .not("status", "in", '("dispatched","cancelled")')
        .order("is_stat", { ascending: false })
        .order("invoice_number", { ascending: false });
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

  // Fetch tests master for LIMS order generation
  const { data: testsMap = {} } = useQuery({
    queryKey: ["tests_sample_tube_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, test_code, sample_tube, tube_color, sample_type, machine_id");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // Fetch parameters with interfacing info.
  // Track BOTH whether the test has any parameters AND the interface-flagged subset,
  // so we can skip tests whose parameters are all manual/calculated (no machine push).
  const { data: testParamData = {} } = useQuery({
    queryKey: ["test_param_interface_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, report_test_parameters(param_code, parameter_name, send_for_interface, machine_id, unit)");
      const map: Record<string, { params: any[]; hasAnyParam: boolean }> = {};
      (data || []).forEach((tp: any) => {
        const p = tp.report_test_parameters;
        if (!p || !tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = { params: [], hasAnyParam: false };
        map[tp.test_id].hasAnyParam = true;
        if (p.send_for_interface) {
          map[tp.test_id].params.push({
            code: p.param_code, name: p.parameter_name,
            machine_id: p.machine_id || "", unit: p.unit || "",
          });
        }
      });
      return map;
    },
  });


  // Group by registration. Dispatched/cancelled regs are already filtered out
  // server-side by the registrations query above.
  const pendingGroups = useMemo((): GroupedRegistration[] => {
    return registrations.filter(reg => collectedTubes.some(t => t.registration_id === reg.id)).map(reg => ({
      registration: reg,
      tubes: collectedTubes.filter(t => t.registration_id === reg.id),
    }));
  }, [registrations, collectedTubes]);

  const acceptedGroups = useMemo((): GroupedRegistration[] => {
    const visibleSet = new Set(visibleAcceptedRegIds);
    return registrations
      .filter(reg => visibleSet.has(reg.id) && acceptedTubes.some(t => t.registration_id === reg.id))
      .map(reg => ({
        registration: reg,
        tubes: acceptedTubes.filter(t => t.registration_id === reg.id),
      }));
  }, [registrations, acceptedTubes, visibleAcceptedRegIds]);


  // Build sample ID map for barcode scanning
  const sampleIdToTubeMap = useMemo(() => {
    const map: Record<string, { reg: any; tube: SampleTubeRow }> = {};
    for (const group of pendingGroups) {
      for (const tube of group.tubes) {
        map[tube.sample_uid] = { reg: group.registration, tube };
      }
    }
    return map;
  }, [pendingGroups]);

  // ─── NEW arrivals badge tracker (only pending list) ───
  const pendingGroupRegIds = useMemo(() => pendingGroups.map(g => g.registration.id), [pendingGroups]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("sample_acceptance", pendingGroupRegIds);

  const toggleTube = (tubeId: string) => {
    setSelectedTubes(prev => {
      const next = new Set(prev);
      if (next.has(tubeId)) next.delete(tubeId); else next.add(tubeId);
      return next;
    });
  };

  const toggleAllForReg = (tubes: SampleTubeRow[]) => {
    setSelectedTubes(prev => {
      const next = new Set(prev);
      const allSelected = tubes.every(t => next.has(t.id));
      if (allSelected) { tubes.forEach(t => next.delete(t.id)); }
      else { tubes.forEach(t => next.add(t.id)); }
      return next;
    });
  };

  // Accept mutation
  const acceptMutation = useMutation({
    mutationFn: async ({ reg, tubeIds }: { reg: any; tubeIds: string[] }) => {
      const now = new Date().toISOString();

      // Update tube status — guarded so a stale double-click can't re-accept already-processed tubes
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "accepted", accepted_at: now, accepted_by: getCurrentUserName() })
        .in("id", tubeIds)
        .eq("status", "collected"); // CRITICAL: only accept tubes still in "collected" state
      if (error) throw error;

      // Get accepted tubes for LIMS order generation
      const acceptedTubesData = collectedTubes.filter(t => tubeIds.includes(t.id));
      
      // Generate LIMS orders for accepted tubes
      for (const tube of acceptedTubesData) {
        const orderTests: any[] = [];
        // Filter out cancelled test IDs before generating orders
        const cancelledTests = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
        const cancelledIds = new Set(
          cancelledTests.map((item: any) => (typeof item === "string" ? item : item?.test_id)).filter(Boolean)
        );
        const activeTestIds = (tube.test_ids || []).filter((id: string) => !cancelledIds.has(id));
        for (const testId of activeTestIds) {
          const testInfo = testsMap[testId] || {};
          const paramData = testParamData[testId];
          if (paramData && paramData.params.length > 0) {
            // Test has parameters AND at least one is flagged for interface — push only those.
            for (const p of paramData.params) {
              orderTests.push({
                code: p.code, name: p.name, unit: p.unit,
                machine_id: p.machine_id || testInfo.machine_id || "",
                status: "pending",
              });
            }
          } else if (paramData && paramData.hasAnyParam) {
            // Test has parameters but NONE are interface-flagged — skip entirely.
            // (All-manual / all-calculated tests must not be pushed to the analyzer.)
            continue;
          } else {
            // Test has zero parameters defined (snip-only / single-result outsourced) — order at test level.
            orderTests.push({
              code: testInfo.test_code || "", name: testInfo.test_name || "",
              unit: "", machine_id: testInfo.machine_id || "", status: "pending",
            });
          }
        }

        if (orderTests.length > 0) {
          const sampleId = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;
          await supabase.from("lims_test_orders").insert({
            sample_id: sampleId, patient_name: reg.patient_name,
            tests: orderTests, status: "pending",
          });
        }
      }

      await recalculateRegistrationStatus(reg.id);
    },
    onSuccess: async (_data, { reg, tubeIds }) => {
      toast.success(`${tubeIds.length} sample(s) accepted & LIMS orders generated`);
      setSelectedTubes(new Set());
      await propagateRegistrationChange(qc, reg.id, ["sample_acceptance", "results", "sample_collection"], { skipRecalc: true });
    },
    onError: (err: any) => toast.error(err.message || "Failed to accept"),
  });

  // Reject mutation — sends selected tubes' tests back for repeat collection only
  const rejectMutation = useMutation({
    mutationFn: async ({ reg, tubeIds, remarks }: { reg: any; tubeIds: string[]; remarks: string }) => {
      const { data: tubes, error } = await supabase
        .from("sample_tubes" as any)
        .select("id, test_ids, test_names")
        .in("id", tubeIds);
      if (error) throw error;
      const tests: Array<{ test_id: string; test_name: string }> = [];
      for (const tube of (tubes || []) as any[]) {
        const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
        const names = Array.isArray(tube.test_names) ? tube.test_names : [];
        ids.forEach((id: string, i: number) => {
          if (id) tests.push({ test_id: id, test_name: names[i] || "" });
        });
      }
      const { applyRepeatCollectionForTests } = await import("@/lib/repeatCollection");
      await applyRepeatCollectionForTests(reg.id, tests, {
        remarks: `Repeat Collection: ${remarks}`,
      });
    },
    onSuccess: async (_data, { reg }) => {
      toast.success("Sample sent back for repeat collection");
      setSelectedTubes(new Set());
      await propagateRegistrationChange(qc, reg.id, ["sample_acceptance", "sample_collection", "results"], { skipRecalc: true });
      setRejectDialog({ open: false, reg: null, tubeIds: [] });
      setRejectRemarks("");
    },
    onError: (err: any) => toast.error(err.message || "Failed"),
  });

  const handleReject = () => {
    if (!rejectRemarks.trim()) { toast.error("Please provide remarks"); return; }
    rejectMutation.mutate({ reg: rejectDialog.reg, tubeIds: rejectDialog.tubeIds, remarks: rejectRemarks.trim() });
  };

  const handleAcceptSelected = () => {
    if (selectedTubes.size === 0) { toast.error("Select at least one sample tube"); return; }
    // Group by registration
    const regMap: Record<string, string[]> = {};
    selectedTubes.forEach(tubeId => {
      const tube = collectedTubes.find(t => t.id === tubeId);
      if (tube) {
        if (!regMap[tube.registration_id]) regMap[tube.registration_id] = [];
        regMap[tube.registration_id].push(tubeId);
      }
    });
    for (const regId of Object.keys(regMap)) {
      const reg = registrations.find((r: any) => r.id === regId);
      if (reg) acceptMutation.mutate({ reg, tubeIds: regMap[regId] });
    }
  };

  // Barcode scan auto-accept
  useEffect(() => {
    if (!search.trim()) return;
    const trimmed = search.trim().toUpperCase();
    const match = sampleIdToTubeMap[trimmed];
    if (match) {
      acceptMutation.mutate({ reg: match.reg, tubeIds: [match.tube.id] });
      setSearch("");
      setDebouncedSearch("");
      toast.info(`Scanned: ${match.tube.sample_uid} → Accepting…`);
    }
  }, [debouncedSearch]);

  const getTubeColorHex = (colorName: string | null) => {
    if (!colorName) return "";
    if (colorName.startsWith("#")) return colorName;
    return TUBE_COLOR_MAP[colorName.toLowerCase()] || "";
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      registered: "Registered", partially_collected: "Partial Collection", sample_collected: "Collected",
      partially_accepted: "Partial Accepted", sample_accepted: "Accepted",
      processing: "Processing", partial_processing: "Partial Processing", processed: "Processed",
      partial_verified: "Partial Verified", verified: "Verified",
      partially_approved: "Partial Approved", approved: "Approved",
      partially_dispatched: "Partial Dispatched", dispatched: "Dispatched",
    };
    return labels[status] || status;
  };

  const renderTable = (groups: GroupedRegistration[], isAccepted: boolean, loading: boolean) => {
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
              <Button size="sm" variant="destructive" onClick={() => {
                if (selectedTubes.size === 0) return;
                // Get first reg for reject dialog
                const firstTubeId = [...selectedTubes][0];
                const tube = collectedTubes.find(t => t.id === firstTubeId);
                if (!tube) return;
                const reg = registrations.find((r: any) => r.id === tube.registration_id);
                if (reg) setRejectDialog({ open: true, reg, tubeIds: [...selectedTubes] });
              }}>
                <RotateCcw className="h-4 w-4 mr-1" /> Repeat Selected
              </Button>
            </div>
          )}
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No samples found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  {!isAccepted && <TableHead className="w-10"></TableHead>}
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Age/Gender</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Tubes</TableHead>
                  <TableHead>Date</TableHead>
                  {!isAccepted && <TableHead className="text-right">Actions</TableHead>}
                  {isAccepted && <TableHead>Status</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(({ registration: reg, tubes }) => {
                  const isExpanded = expandedRow === reg.id;
                  const allSelected = tubes.every(t => selectedTubes.has(t.id));
                  const someSelected = tubes.some(t => selectedTubes.has(t.id));

                  return (
                    <>
                      <TableRow key={reg.id} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => { markArrivalSeen(reg.id); setExpandedRow(isExpanded ? null : reg.id); }}>
                        <TableCell>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </TableCell>
                        {!isAccepted && (
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Checkbox checked={allSelected}
                              onCheckedChange={() => toggleAllForReg(tubes)}
                              className={someSelected && !allSelected ? "data-[state=unchecked]:bg-primary/30" : ""} />
                          </TableCell>
                        )}
                        <TableCell className="font-mono font-medium">{reg.invoice_number}</TableCell>
                        <TableCell>
                          <span className="font-medium">{patientDisplayName(reg)}</span>
                          {!isAccepted && <NewBadge show={isNewArrival(reg.id)} className="ml-1.5 align-middle" />}
                          {reg.is_stat && (
                            <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                            </span>
                          )}
                          {isAccepted && reg.status !== "sample_accepted" && reg.status !== "dispatched" && (
                            <Badge variant="outline" className="ml-2 text-xs">{statusLabel(reg.status)}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{formatAgeGender(reg.dob, reg.gender)}</TableCell>
                        <TableCell>{reg.mobile_number}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {tubes.map((t, i) => {
                              const hex = getTubeColorHex(t.tube_color);
                              return (
                                <Badge key={i} variant="outline" className="text-xs gap-1">
                                  {hex && <span className="inline-block w-2.5 h-2.5 rounded-full border"
                                    style={{ backgroundColor: hex, borderColor: hex === "#ffffff" ? "#ccc" : hex }} />}
                                  {t.tube_type || "DEFAULT"}{t.suffix ? ` (${t.suffix})` : ""}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{format(new Date(reg.updated_at), "dd-MM-yyyy hh:mm a")}</TableCell>
                        {!isAccepted && (
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="outline" title="Reprint all barcodes"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  printBarcodes(reg, tubes);
                                  toast.success(`Reprinting ${tubes.length} barcode(s)`);
                                }}>
                                <Printer className="h-4 w-4 mr-1" /> Print All
                              </Button>
                              <Button size="sm" onClick={() => acceptMutation.mutate({ reg, tubeIds: tubes.map(t => t.id) })}
                                disabled={acceptMutation.isPending}>
                                <ShieldCheck className="h-4 w-4 mr-1" /> Accept All
                              </Button>
                              <Button size="sm" variant="destructive"
                                onClick={() => setRejectDialog({ open: true, reg, tubeIds: tubes.map(t => t.id) })}>
                                <RotateCcw className="h-4 w-4 mr-1" /> Repeat
                              </Button>
                            </div>
                          </TableCell>
                        )}
                        {isAccepted && (
                          <TableCell className="text-sm text-muted-foreground" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <span>{statusLabel(reg.status)}</span>
                              <Button size="sm" variant="outline" title="Reprint all barcodes"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  printBarcodes(reg, tubes);
                                  toast.success(`Reprinting ${tubes.length} barcode(s)`);
                                }}>
                                <Printer className="h-4 w-4 mr-1" /> Print All
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${reg.id}-detail`}>
                          <TableCell colSpan={isAccepted ? 8 : 9} className="bg-muted/30 p-4">
                            <div className="space-y-2">
                              <div className="text-sm font-medium">Sample Details</div>
                              {tubes.map((tube) => {
                                const isChecked = selectedTubes.has(tube.id);
                                return (
                                  <div key={tube.id} className="flex items-start gap-3 p-2 bg-background rounded border">
                                    {!isAccepted && (
                                      <div className="pt-1">
                                        <Checkbox checked={isChecked} onCheckedChange={() => toggleTube(tube.id)} />
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 min-w-[140px]">
                                      {getTubeColorHex(tube.tube_color) && (
                                        <span className="inline-block w-3 h-3 rounded-full border"
                                          style={{
                                            backgroundColor: getTubeColorHex(tube.tube_color),
                                            borderColor: getTubeColorHex(tube.tube_color) === "#ffffff" ? "#ccc" : getTubeColorHex(tube.tube_color),
                                          }} />
                                      )}
                                      <span className="font-medium text-sm">{tube.tube_type || "DEFAULT"}</span>
                                      {tube.suffix && <Badge variant="secondary" className="text-xs">{tube.suffix}</Badge>}
                                    </div>
                                    <div className="flex-1">
                                      <div className="text-xs text-muted-foreground mb-1">
                                        Sample UID: <span className="font-mono font-medium">{tube.sample_uid}</span>
                                        {tube.sample_type && <> • {tube.sample_type}</>}
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {(tube.test_names || []).map((name, j) => (
                                          <Badge key={j} variant="outline" className="text-xs">{name}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                    {isAccepted && tube.accepted_at && (
                                      <Badge className="text-xs bg-green-100 text-green-700 border-green-300 whitespace-nowrap">
                                        {format(new Date(tube.accepted_at), "dd-MM-yyyy hh:mm a")}
                                      </Badge>
                                    )}
                                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                      <Button size="sm" variant="outline" className="h-7 text-xs" title="Reprint barcode"
                                        onClick={() => {
                                          printBarcodes(reg, [tube]);
                                          toast.success(`Reprinting barcode for ${tube.sample_uid}`);
                                        }}>
                                        <Printer className="h-3 w-3" />
                                      </Button>
                                      {!isAccepted && (
                                        <>
                                          <Button size="sm" variant="outline" className="h-7 text-xs"
                                            onClick={() => acceptMutation.mutate({ reg, tubeIds: [tube.id] })}
                                            disabled={acceptMutation.isPending}>
                                            <ShieldCheck className="h-3 w-3 mr-1" /> Accept
                                          </Button>
                                          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/50"
                                            onClick={() => setRejectDialog({ open: true, reg, tubeIds: [tube.id] })}>
                                            <RotateCcw className="h-3 w-3 mr-1" /> Repeat
                                          </Button>
                                        </>
                                      )}
                                    </div>
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
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input ref={searchRef} placeholder="Scan barcode or search by name, mobile, invoice…"
            value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9" />
          <ScanBarcode className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
          <Checkbox
            checked={showOlderPending}
            onCheckedChange={(v) => setShowOlderPending(v === true)}
          />
          Show older pending
          <span className="text-xs hidden sm:inline">(beyond 30 days)</span>
        </label>
        <RefreshButton
          queryKeys={["sample_tubes_acceptance_pending", "sample_tubes_acceptance_accepted", "sample_acceptance_regs", "tests_sample_tube_map", "test_param_interface_map", "patient_registrations"]}
          className="ml-auto"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending Acceptance
            {pendingGroups.length > 0 && <Badge variant="secondary" className="ml-2 text-xs">{pendingGroups.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="accepted">
            Accepted
            {totalAcceptedCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {hasMoreAccepted ? `${acceptedGroups.length} / ${totalAcceptedCount}` : totalAcceptedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending">{renderTable(pendingGroups, false, isLoading)}</TabsContent>
        <TabsContent value="accepted">
          {renderTable(acceptedGroups, true, isLoadingAccepted)}
          {hasMoreAccepted && (
            <div className="flex justify-center mt-4">
              <Button
                variant="outline"
                onClick={() => setAcceptedLimit((n) => n + ACCEPTED_PAGE_SIZE)}
              >
                Load {Math.min(ACCEPTED_PAGE_SIZE, totalAcceptedCount - acceptedLimit)} more
                <span className="ml-2 text-xs text-muted-foreground">
                  (showing {acceptedGroups.length} of {totalAcceptedCount})
                </span>
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Reject / Repeat Collection Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => { if (!o) { setRejectDialog({ open: false, reg: null, tubeIds: [] }); setRejectRemarks(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Repeat Collection</DialogTitle>
            <DialogDescription>
              Patient: <strong>{patientDisplayName(rejectDialog.reg)}</strong> ({rejectDialog.reg?.invoice_number})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
              <AlertTriangle className="h-4 w-4" />
              Sample will be sent back for re-collection.
            </div>
            <Textarea
              placeholder="Enter reason for repeat collection (e.g., hemolyzed, clotted, insufficient quantity)…"
              value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialog({ open: false, reg: null, tubeIds: [] }); setRejectRemarks(""); }}>Cancel</Button>
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
