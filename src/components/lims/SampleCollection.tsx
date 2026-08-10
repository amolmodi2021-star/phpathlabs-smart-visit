import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
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
import { Search, Printer, ChevronDown, ChevronUp, CheckCircle2, RotateCcw, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { printBarcodes } from "@/lib/barcodePrint";
import { patientDisplayName } from "@/lib/patientDisplayName";

import { buildSampleTubeGroups, TubeGroupingItem } from "@/lib/sampleTubeGrouping";
import { formatAgeGender } from "@/lib/ageGender";
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

const SampleCollection = () => {
  const qc = useQueryClient();
  // Single channel for both tables — fewer realtime listeners per client.
  // Only patient_registrations is in the realtime publication; sample_tubes is not.
  // Local writes use propagateRegistrationChange to invalidate immediately.
  // Cost optimization: no ambient realtime; same-user via propagateRegistrationChange, cross-user via refetchOnWindowFocus.
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  /** Off by default (14-day window). On = all pending/collected tubes still in pipeline. */
  const [showOlderPending, setShowOlderPending] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedTubes, setSelectedTubes] = useState<Record<string, Set<string>>>({});
  const printRef = useRef<HTMLDivElement>(null);

  // Reprint dialog state
  const [reprintDialog, setReprintDialog] = useState<{ open: boolean; reg: any; tubes: SampleTubeRow[] }>({ open: false, reg: null, tubes: [] });
  const [reprintReason, setReprintReason] = useState("");
  const [reprintSelectedTubes, setReprintSelectedTubes] = useState<Set<string>>(new Set());

  // Cancel collection (revert to pending) dialog state
  const [cancelCollectDialog, setCancelCollectDialog] = useState<{ open: boolean; reg: any; tube: SampleTubeRow | null }>({ open: false, reg: null, tube: null });

  // Print confirmation dialog state — shown before any print action
  const [printConfirmDialog, setPrintConfirmDialog] = useState<{ open: boolean; reg: any; tubes: SampleTubeRow[]; action: (() => void) | null }>({ open: false, reg: null, tubes: [], action: null });

  const getBarcodeLabel = (reg: any, tube: SampleTubeRow) => {
    const suffix = tube.suffix?.trim();
    return suffix ? `${reg.invoice_number}${suffix}` : String(reg.invoice_number);
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__scSearchTimeout);
    (window as any).__scSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch sample_tubes still in collection pipeline (pending / collected).
  // Default: last 14 days. Optional: include older backlog still awaiting workflow.
  const { data: allTubes = [], isLoading } = useQuery({
    queryKey: ["sample_tubes_collection", showOlderPending],
    queryFn: async () => {
      let q = supabase
        .from("sample_tubes" as any)
        .select("*")
        .in("status", ["pending", "collected"])
        .order("created_at", { ascending: false })
        .limit(showOlderPending ? 2000 : 500);
      if (!showOlderPending) {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        q = q.gte("created_at", fourteenDaysAgo.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as SampleTubeRow[];
    },
    staleTime: 30_000,
  });

  // Get unique registration IDs from tubes
  const regIds = useMemo(() => [...new Set(allTubes.map(t => t.registration_id))], [allTubes]);

  // Fetch registrations for those IDs
  const { data: registrations = [] } = useQuery({
    queryKey: ["sample_collection_regs", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .in("id", regIds)
        .eq("bill_cancelled", false)
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

  // Fetch pickup points for location display
  const { data: pickupPoints = [] } = useQuery({
    queryKey: ["pickup_points_lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("id, name");
      return (data || []) as { id: string; name: string }[];
    },
  });
  const ppMap = Object.fromEntries(pickupPoints.map(p => [p.id, p.name]));

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
  // Only touches PENDING tubes — already-collected/accepted tubes are preserved untouched.
  const recalcTubesForRegistration = useCallback(async (regId: string) => {
    const reg = registrations.find((r: any) => r.id === regId);
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
      .select("*")
      .eq("registration_id", regId)
      .eq("status", "pending");
    const pendingExisting = (existingTubes || []) as any[];

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
    qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
    toast.success("Sample tubes recalculated from latest test setup");
  }, [registrations, qc]);

  const pendingGroups = useMemo((): GroupedRegistration[] => {
    return registrations.filter(reg => {
      const tubes = allTubes.filter(t => t.registration_id === reg.id && !isTubeFullyCancelled(t, reg));
      return tubes.some(t => t.status === "pending");
    }).map(reg => ({
      registration: reg,
      tubes: allTubes.filter(t => t.registration_id === reg.id && !isTubeFullyCancelled(t, reg)),
    }));
  }, [registrations, allTubes]);

  const collectedGroups = useMemo((): GroupedRegistration[] => {
    return registrations.filter(reg => {
      const tubes = allTubes.filter(t => t.registration_id === reg.id && !isTubeFullyCancelled(t, reg));
      return tubes.some(t => t.status === "collected");
    }).map(reg => ({
      registration: reg,
      tubes: allTubes.filter(t => t.registration_id === reg.id && t.status === "collected" && !isTubeFullyCancelled(t, reg)),
    }));
  }, [registrations, allTubes]);

  // ─── NEW arrivals badge tracker (only pending list) ───
  const pendingRegIds = useMemo(() => pendingGroups.map(g => g.registration.id), [pendingGroups]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("sample_collection", pendingRegIds);

  const toggleTube = (regId: string, tubeId: string) => {
    setSelectedTubes(prev => {
      const regSet = new Set(prev[regId] || []);
      if (regSet.has(tubeId)) regSet.delete(tubeId);
      else regSet.add(tubeId);
      return { ...prev, [regId]: regSet };
    });
  };

  const toggleAllPendingTubes = (regId: string, tubes: SampleTubeRow[], selectAll: boolean) => {
    setSelectedTubes(prev => {
      const regSet = new Set<string>();
      if (selectAll) {
        tubes.filter(t => t.status === "pending").forEach(t => regSet.add(t.id));
      }
      return { ...prev, [regId]: regSet };
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

  // Mark tubes as collected — guarded so already accepted/processed tubes are NEVER demoted
  const collectMutation = useMutation({
    mutationFn: async ({ regId, tubeIds }: { regId: string; tubeIds: string[] }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "collected", collected_at: now, collected_by: getCurrentUserName() })
        .in("id", tubeIds)
        .eq("status", "pending"); // CRITICAL: only collect tubes still pending; never revert accepted/processed tubes
      if (error) throw error;
      await recalculateRegistrationStatus(regId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_regs"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_acceptance"] });
      setSelectedTubes({});
      toast.success("Samples marked as collected");
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
      qc.invalidateQueries({ queryKey: ["sample_collection_regs"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_acceptance"] });
      setCancelCollectDialog({ open: false, reg: null, tube: null });
      toast.success("Collection cancelled — tube reverted to pending");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestPrintConfirm = (reg: any, tubes: SampleTubeRow[], action: () => void) => {
    if (tubes.length === 0) { toast.error("No tubes to print"); return; }
    setPrintConfirmDialog({ open: true, reg, tubes, action });
  };

  const doPrintAndCollect = (reg: any, tubes: SampleTubeRow[]) => {
    const regSel = selectedTubes[reg.id] || new Set();
    const selected = tubes.filter(t => regSel.has(t.id));
    if (selected.length === 0) { toast.error("Please select at least one barcode"); return; }
    void doPrintBarcodes(reg, selected);
    const toCollect = selected.filter(t => t.status === "pending");
    if (toCollect.length === 0) {
      toast.info("Tubes already collected/accepted — barcode reprinted only");
      setSelectedTubes(prev => ({ ...prev, [reg.id]: new Set() }));
      return;
    }
    collectMutation.mutate({ regId: reg.id, tubeIds: toCollect.map(t => t.id) });
  };

  const handlePrintAndCollect = (reg: any, tubes: SampleTubeRow[]) => {
    const regSel = selectedTubes[reg.id] || new Set();
    const selected = tubes.filter(t => regSel.has(t.id));
    if (selected.length === 0) { toast.error("Please select at least one barcode"); return; }
    requestPrintConfirm(reg, selected, () => doPrintAndCollect(reg, tubes));
  };

  const doSinglePrintAndCollect = (reg: any, tube: SampleTubeRow) => {
    void doPrintBarcodes(reg, [tube]);
    if (tube.status !== "pending") {
      toast.info("Tube already collected/accepted — barcode reprinted only");
      return;
    }
    collectMutation.mutate({ regId: reg.id, tubeIds: [tube.id] });
  };

  const handleSinglePrintAndCollect = (reg: any, tube: SampleTubeRow) => {
    requestPrintConfirm(reg, [tube], () => doSinglePrintAndCollect(reg, tube));
  };

  // Reprint
  const openReprintDialog = (group: GroupedRegistration) => {
    const allTubesForReg = allTubes.filter(t => t.registration_id === group.registration.id);
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

  const renderTubeExpansion = (group: GroupedRegistration, isPending: boolean) => {
    const reg = group.registration;
    const tubes = group.tubes;
    const pendingTubes = tubes.filter(t => t.status === "pending");
    const collectedTubes = tubes.filter(t => t.status === "collected");
    const regSel = selectedTubes[reg.id] || new Set();
    const selectedPendingCount = pendingTubes.filter(t => regSel.has(t.id)).length;
    const allPendingSelected = pendingTubes.length > 0 && pendingTubes.every(t => regSel.has(t.id));
    const repeatTestIds = new Set(
      (Array.isArray(reg.repeat_tests) ? reg.repeat_tests : [])
        .map((x: any) => x?.test_id)
        .filter(Boolean),
    );

    const displayTubes = isPending ? tubes : collectedTubes;

    return (
      <div className="bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            Sample Tubes
            {isPending && collectedTubes.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({collectedTubes.length} collected, {pendingTubes.length} remaining)
              </span>
            )}
          </h4>
          <div className="flex gap-2">
            {isPending && pendingTubes.length > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => toggleAllPendingTubes(reg.id, tubes, !allPendingSelected)}>
                  {allPendingSelected ? "Deselect All" : "Select All"}
                </Button>
                <Button size="sm" variant="default" className="gap-1" disabled={selectedPendingCount === 0}
                  onClick={() => handlePrintAndCollect(reg, tubes)}>
                  <Printer className="h-3.5 w-3.5" /> Print & Collect ({selectedPendingCount})
                </Button>
              </>
            )}
            {!isPending && collectedTubes.length > 0 && (
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
            const isSelected = regSel.has(tube.id);
            const isRepeatTube =
              Array.isArray(tube.test_ids) && tube.test_ids.some((id: string) => repeatTestIds.has(id));
            return (
              <Card key={tube.id} className={`${isCollected && isPending ? "opacity-60" : ""} ${isPending && !isCollected && isSelected ? "ring-2 ring-primary" : ""} ${isRepeatTube && !isCollected ? "border-destructive/50" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {isPending && !isCollected && (
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleTube(reg.id, tube.id)} />
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
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {getActiveTestNames(tube, reg).join(", ")}
                    </p>
                  </div>
                  {isPending && !isCollected && (
                    <Button size="sm" variant="ghost" className="shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleSinglePrintAndCollect(reg, tube); }}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {!isPending && isCollected && (
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

  const renderTable = (groups: GroupedRegistration[], isPending: boolean, loading: boolean) => {
    if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
    if (groups.length === 0) return (
      <p className="text-sm text-muted-foreground">
        {isPending ? "No registered patients pending sample collection" : "No collected samples found"}
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
            const collectedTubes = tubes.filter(t => t.status === "collected");

            return (
              <>
                <TableRow key={reg.id}
                  className={`cursor-pointer hover:bg-muted/50 ${reg.is_stat ? "bg-destructive/5 border-l-2 border-l-destructive" : ""}`}
                  onClick={() => {
                    const next = isExpanded ? null : reg.id;
                    markArrivalSeen(reg.id);
                    setExpandedRow(next);
                    if (next) void recalcTubesForRegistration(reg.id);
                  }}>
                  <TableCell>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold">{reg.invoice_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {patientDisplayName(reg)}
                      {isPending && <NewBadge show={isNewArrival(reg.id)} className="ml-1.5 align-middle" />}
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
                      {isPending && collectedTubes.length > 0 && pendingTubes.length > 0 && (
                        <Badge className="ml-2 text-xs bg-amber-500 text-white border-0">PARTIAL</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{formatAgeGender(reg.dob, reg.gender)}</TableCell>
                  <TableCell className="text-sm">{reg.mobile_number}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{getVisitLabel(reg.visit_type)}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {tubes.length} tube(s)
                    {isPending && collectedTubes.length > 0 && (
                      <span className="text-xs text-green-600 ml-1">({collectedTubes.length} done)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(reg.created_at), "dd/MM/yy HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    {isPending ? (
                      <Button size="sm" variant="default" className="gap-1"
                        onClick={(e) => { e.stopPropagation(); toggleAllPendingTubes(reg.id, tubes, true); setExpandedRow(reg.id); }}>
                        <Printer className="h-3.5 w-3.5" /> Print All
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
                      {renderTubeExpansion({ registration: reg, tubes }, isPending)}
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
        <div className="relative flex-1 max-w-md min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, mobile, invoice..." className="pl-8" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap">
          <Checkbox
            checked={showOlderPending}
            onCheckedChange={(v) => setShowOlderPending(v === true)}
          />
          Show older pending
          <span className="text-xs hidden sm:inline">(beyond 14 days)</span>
        </label>
        <RefreshButton
          queryKeys={["sample_tubes_collection", "sample_collection_regs", "pickup_points_lookup", "patient_registrations"]}
          className="ml-auto"
        />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setExpandedRow(null); }}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending <Badge variant="secondary" className="text-xs ml-1">{pendingGroups.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="collected" className="gap-1.5">
            Collected <Badge variant="secondary" className="text-xs ml-1">{collectedGroups.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-3">
          {renderTable(pendingGroups, true, isLoading)}
        </TabsContent>
        <TabsContent value="collected" className="mt-3">
          {renderTable(collectedGroups, false, isLoading)}
        </TabsContent>
      </Tabs>

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

      <div ref={printRef} className="hidden" />
    </div>
  );
};

export default SampleCollection;
