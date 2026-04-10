import { useState, useRef, useCallback } from "react";
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
import { Search, Printer, ChevronDown, ChevronUp, CheckCircle2, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";

const TUBE_COLOR_MAP: Record<string, string> = {
  red: "#e53e3e", lavender: "#b794f4", purple: "#9f7aea", yellow: "#ecc94b",
  green: "#48bb78", blue: "#4299e1", grey: "#a0aec0", gray: "#a0aec0",
  white: "#ffffff", orange: "#ed8936", pink: "#ed64a6", black: "#1a202c",
};

interface BarcodeGroup {
  groupKey: string;
  sampleId: string;
  sampleTube: string;
  tubeColor: string;
  sampleType: string;
  suffix: string;
  testNames: string[];
  selected: boolean;
  isCollected: boolean;
}

const SampleCollection = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedBarcodes, setSelectedBarcodes] = useState<Record<string, Record<string, boolean>>>({});
  const printRef = useRef<HTMLDivElement>(null);

  // Reprint dialog state
  const [reprintDialog, setReprintDialog] = useState<{ open: boolean; reg: any; groups: BarcodeGroup[] }>({ open: false, reg: null, groups: [] });
  const [reprintReason, setReprintReason] = useState("");
  const [reprintSelectedBarcodes, setReprintSelectedBarcodes] = useState<Record<number, boolean>>({});

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__scSearchTimeout);
    (window as any).__scSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch registered patients (pending)
  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["sample_collection_patients", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .in("status", ["registered", "repeat_collection"])
        .eq("bill_cancelled", false)
        .order("created_at", { ascending: false });

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

  // Fetch collected patients
  const { data: collectedRegistrations = [], isLoading: isLoadingCollected } = useQuery({
    queryKey: ["sample_collected_patients", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .or("status.eq.sample_collected,collected_samples.neq.[]")
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

  // Fetch all tests with sample_tube info
  const { data: testsMap = {} } = useQuery({
    queryKey: ["tests_sample_tube_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tests")
        .select("id, test_name, sample_tube, tube_color, sample_type");
      const map: Record<string, { sample_tube: string; tube_color: string; sample_type: string }> = {};
      (data || []).forEach((t: any) => {
        map[t.id] = {
          sample_tube: t.sample_tube || "",
          tube_color: t.tube_color || "",
          sample_type: t.sample_type || "",
        };
      });
      return map;
    },
  });

  // Fetch parameters with custom suffix via test_parameters junction
  const { data: testSuffixMap = {} } = useQuery({
    queryKey: ["test_suffix_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, report_test_parameters!inner(custom_sample_suffix_enabled, custom_sample_suffix)")
        .eq("report_test_parameters.custom_sample_suffix_enabled", true);
      const map: Record<string, string> = {};
      (data || []).forEach((tp: any) => {
        const suffix = tp.report_test_parameters?.custom_sample_suffix;
        if (tp.test_id && suffix) {
          map[tp.test_id] = suffix;
        }
      });
      return map;
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

  // Build barcode groups for a registration
  const buildBarcodeGroups = useCallback((reg: any): BarcodeGroup[] => {
    const tests = (reg.tests || []) as any[];
    const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
    const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));
    const collectedKeys = (reg.collected_samples || []) as string[];

    const groupMap: Record<string, BarcodeGroup> = {};

    for (const t of activeTests) {
      const testInfo = testsMap[t.test_id] || { sample_tube: "", tube_color: "", sample_type: "" };
      const tube = testInfo.sample_tube || "DEFAULT";
      const tubeColor = testInfo.tube_color || "";
      const sampleType = testInfo.sample_type || "";
      const suffix = testSuffixMap[t.test_id] || "";
      const groupKey = `${tube}||${suffix}`;

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          groupKey,
          sampleId: suffix ? `${reg.invoice_number}${suffix}` : reg.invoice_number,
          sampleTube: tube,
          tubeColor,
          sampleType,
          suffix,
          testNames: [],
          selected: false,
          isCollected: collectedKeys.includes(groupKey),
        };
      }
      groupMap[groupKey].testNames.push(t.test_name);
    }

    return Object.values(groupMap);
  }, [testsMap, testSuffixMap]);

  const toggleBarcode = (regId: string, idx: number) => {
    setSelectedBarcodes(prev => {
      const regSel = { ...(prev[regId] || {}) };
      regSel[idx] = !regSel[idx];
      return { ...prev, [regId]: regSel };
    });
  };

  const toggleAllBarcodes = (regId: string, groups: BarcodeGroup[], selectAll: boolean) => {
    setSelectedBarcodes(prev => {
      const regSel: Record<number, boolean> = {};
      groups.forEach((g, i) => { regSel[i] = g.isCollected ? false : selectAll; });
      return { ...prev, [regId]: regSel };
    });
  };

  const calcAge = (dob: string | null) => {
    if (!dob) return "";
    const birth = new Date(dob);
    const now = new Date();
    const years = now.getFullYear() - birth.getFullYear();
    return `${years}`;
  };

  // Print barcodes helper — returns a Promise that resolves after print dialog
  const doPrintBarcodes = (reg: any, toPrint: BarcodeGroup[]): Promise<void> => {
    return new Promise((resolve) => {
      const printWindow = window.open("", "_blank", "width=400,height=600");
      if (!printWindow) {
        toast.error("Pop-up blocked. Please allow pop-ups.");
        resolve();
        return;
      }

      const age = calcAge(reg.dob);
      const gender = reg.gender ? reg.gender.charAt(0) : "";
      const location = reg.pickup_point_id ? ppMap[reg.pickup_point_id] || "" : "";
      const dateTime = format(new Date(), "dd/MM/yy HH:mm a");
      const patientName = reg.patient_name || "";

      let html = `<!DOCTYPE html><html><head><style>
        @page { margin: 2mm; size: 50mm 25mm; }
        body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; }
        .label { 
          width: 48mm; height: 23mm; padding: 1.5mm; box-sizing: border-box;
          page-break-after: always; position: relative; overflow: hidden;
        }
        .label:last-child { page-break-after: auto; }
        .row1 { display: flex; justify-content: space-between; font-size: 7pt; font-weight: bold; line-height: 1.2; }
        .row2 { font-size: 6.5pt; font-weight: bold; line-height: 1.2; margin-top: 0.5mm; }
        .barcode-wrap { text-align: center; margin: 0.5mm 0; }
        .barcode-wrap svg { width: 42mm; height: 8mm; }
        .sample-id { text-align: center; font-size: 7pt; font-weight: bold; line-height: 1; }
        .row-bottom { display: flex; justify-content: space-between; font-size: 6pt; line-height: 1.2; margin-top: 0.5mm; }
      </style></head><body>`;

      for (const group of toPrint) {
        const canvas = document.createElement("canvas");
        try {
          JsBarcode(canvas, group.sampleId, {
            format: "CODE128", width: 1.5, height: 30, displayValue: false, margin: 0,
          });
        } catch { /* fallback */ }
        const barcodeDataUrl = canvas.toDataURL("image/png");

        html += `<div class="label">
          <div class="row1">
            <span>${reg.invoice_number}</span>
            <span>${age}${gender ? `/${gender}` : ""}</span>
          </div>
          <div class="row2">${patientName}${location ? ` &nbsp; PH ${location}` : ""}</div>
          <div class="barcode-wrap">
            <img src="${barcodeDataUrl}" style="width:42mm;height:8mm;" />
          </div>
          <div class="sample-id">${group.sampleId}</div>
          <div class="row-bottom">
            <span>${group.sampleType || group.sampleTube}</span>
            <span>${dateTime}</span>
          </div>
        </div>`;
      }

      html += "</body></html>";
      printWindow.document.write(html);
      printWindow.document.close();

      let resolved = false;
      const doResolve = () => { if (!resolved) { resolved = true; resolve(); } };

      printWindow.onafterprint = () => { doResolve(); };

      printWindow.onload = () => {
        printWindow.print();
        // Fallback: resolve after 1s in case onafterprint isn't supported
        setTimeout(doResolve, 1000);
      };

      // Safety fallback if onload never fires
      setTimeout(doResolve, 3000);
    });
  };

  // Print barcodes (pending tab)
  const printBarcodes = (reg: any, groups: BarcodeGroup[]) => {
    const sel = selectedBarcodes[reg.id] || {};
    const toPrint = groups.filter((_, i) => sel[i]);
    if (toPrint.length === 0) {
      toast.error("Please select at least one barcode to print");
      return;
    }
    doPrintBarcodes(reg, toPrint);
  };

  // Mark sample collected (full)
  const markCollectedMutation = useMutation({
    mutationFn: async ({ regId, collectedKeys }: { regId: string; collectedKeys: string[] }) => {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ status: "sample_collected", collected_samples: collectedKeys } as any)
        .eq("id", regId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
      qc.invalidateQueries({ queryKey: ["sample_collected_patients"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      toast.success("Status updated to Sample Collected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Partial collect mutation
  const partialCollectMutation = useMutation({
    mutationFn: async ({ regId, collectedKeys }: { regId: string; collectedKeys: string[] }) => {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ collected_samples: collectedKeys } as any)
        .eq("id", regId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePrintAndCollect = async (reg: any, groups: BarcodeGroup[]) => {
    const sel = selectedBarcodes[reg.id] || {};
    const selectedOriginalIndices = groups.map((g, i) => (!g.isCollected && sel[i]) ? i : -1).filter(i => i >= 0);
    const toPrint = selectedOriginalIndices.map(i => groups[i]);
    
    if (toPrint.length === 0) {
      toast.error("Please select at least one barcode");
      return;
    }
    
    // Wait for print to finish before mutating
    await doPrintBarcodes(reg, toPrint);
    
    // Merge with existing collected keys
    const existingCollected = (reg.collected_samples || []) as string[];
    const newKeys = toPrint.map(g => g.groupKey);
    const allCollectedKeys = [...new Set([...existingCollected, ...newKeys])];
    
    const allGroupKeys = groups.map(g => g.groupKey);
    const allNowCollected = allGroupKeys.every(k => allCollectedKeys.includes(k));
    
    if (allNowCollected) {
      markCollectedMutation.mutate({ regId: reg.id, collectedKeys: allCollectedKeys });
    } else {
      partialCollectMutation.mutate({ regId: reg.id, collectedKeys: allCollectedKeys });
      toast.success(`${toPrint.length} of ${groups.length} samples collected. ${groups.length - allCollectedKeys.length} remaining.`);
    }
  };

  // Reprint dialog handlers
  const openReprintDialog = (reg: any) => {
    const groups = buildBarcodeGroups(reg);
    const allSel: Record<number, boolean> = {};
    groups.forEach((_, i) => { allSel[i] = true; });
    setReprintSelectedBarcodes(allSel);
    setReprintReason("");
    setReprintDialog({ open: true, reg, groups });
  };

  const handleReprint = () => {
    if (!reprintReason.trim()) {
      toast.error("Please provide a reason for reprinting");
      return;
    }
    const toPrint = reprintDialog.groups.filter((_, i) => reprintSelectedBarcodes[i]);
    if (toPrint.length === 0) {
      toast.error("Please select at least one barcode");
      return;
    }
    doPrintBarcodes(reprintDialog.reg, toPrint);
    toast.success(`Reprinted ${toPrint.length} barcode(s). Reason: ${reprintReason.trim()}`);
    setReprintDialog({ open: false, reg: null, groups: [] });
  };

  const getVisitLabel = (v: string) => {
    switch (v) {
      case "lab_visit": return "Lab";
      case "home_visit": return "Home";
      case "pickup_point": return "Pickup";
      default: return v;
    }
  };

  const getTubeColorHex = (color: string) => {
    if (!color) return undefined;
    return TUBE_COLOR_MAP[color.toLowerCase().trim()] || color;
  };

  const renderBarcodeExpansion = (reg: any, groups: BarcodeGroup[], isPending: boolean) => {
    const sel = isPending ? (selectedBarcodes[reg.id] || {}) : {};
    const pendingGroups = groups.filter(g => !g.isCollected);
    const collectedGroups = groups.filter(g => g.isCollected);
    const selectedPendingCount = isPending ? groups.filter((g, i) => !g.isCollected && sel[i]).length : 0;
    const allPendingSelected = isPending && pendingGroups.length > 0 && pendingGroups.every(g => {
      const idx = groups.indexOf(g);
      return sel[idx];
    });

    return (
      <div className="bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            Sample Barcodes
            {isPending && collectedGroups.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({collectedGroups.length} collected, {pendingGroups.length} remaining)
              </span>
            )}
          </h4>
          {isPending && pendingGroups.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                const allSel = allPendingSelected;
                toggleAllBarcodes(reg.id, groups, !allSel);
              }}>
                {allPendingSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button size="sm" variant="default" className="gap-1" disabled={selectedPendingCount === 0}
                onClick={() => handlePrintAndCollect(reg, groups)}>
                <Printer className="h-3.5 w-3.5" />
                Print & Collect ({selectedPendingCount})
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          {groups.map((group, idx) => {
            const colorHex = getTubeColorHex(group.tubeColor);
            const isCollected = group.isCollected;
            return (
              <Card key={idx} className={`${isCollected ? "opacity-60" : ""} ${isPending && !isCollected && sel[idx] ? "ring-2 ring-primary" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {isPending && (
                    <Checkbox 
                      checked={isCollected ? true : !!sel[idx]} 
                      disabled={isCollected}
                      onCheckedChange={() => !isCollected && toggleBarcode(reg.id, idx)} 
                    />
                  )}
                  {colorHex && (
                    <span className="inline-block w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0"
                      style={{ backgroundColor: colorHex }} title={group.tubeColor} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{group.sampleId}</span>
                      <Badge variant="outline" className="text-xs">
                        {group.sampleTube === "DEFAULT" ? "No Tube" : group.sampleTube}
                      </Badge>
                      {group.sampleType && (
                        <span className="text-xs text-muted-foreground">{group.sampleType}</span>
                      )}
                      {isCollected && (
                        <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Collected
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {group.testNames.join(", ")}
                    </p>
                  </div>
                  {isPending && !isCollected && (
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={async (e) => {
                      e.stopPropagation();
                      await doPrintBarcodes(reg, [group]);
                      // Mark this single tube as collected after print
                      const existingCollected = (reg.collected_samples || []) as string[];
                      const allCollectedKeys = [...new Set([...existingCollected, group.groupKey])];
                      const allGroupKeys = groups.map(g => g.groupKey);
                      const allNowCollected = allGroupKeys.every(k => allCollectedKeys.includes(k));
                      if (allNowCollected) {
                        markCollectedMutation.mutate({ regId: reg.id, collectedKeys: allCollectedKeys });
                      } else {
                        partialCollectMutation.mutate({ regId: reg.id, collectedKeys: allCollectedKeys });
                        toast.success(`Sample collected. ${allGroupKeys.length - allCollectedKeys.length} remaining.`);
                      }
                    }}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isPending && allPendingSelected && pendingGroups.length > 0 && (
          <Button className="w-full gap-2" onClick={() => {
            const existingCollected = (reg.collected_samples || []) as string[];
            const allKeys = groups.map(g => g.groupKey);
            markCollectedMutation.mutate({ regId: reg.id, collectedKeys: [...new Set([...existingCollected, ...allKeys])] });
          }}>
            <CheckCircle2 className="h-4 w-4" /> Mark as Sample Collected
          </Button>
        )}
      </div>
    );
  };

  const renderTable = (data: any[], isPending: boolean, loading: boolean) => {
    if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
    if (data.length === 0) return (
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
            <TableHead>Mobile</TableHead>
            <TableHead>Visit</TableHead>
            <TableHead>Tests</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.filter((reg: any) => {
            const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
            return ((reg.tests || []) as any[]).some((t: any) => !cancelledIds.has(t.test_id));
          }).map((reg: any) => {
            const groups = buildBarcodeGroups(reg);
            const isExpanded = expandedRow === reg.id;
            const sel = selectedBarcodes[reg.id] || {};
            const activeTests = ((reg.tests || []) as any[]).filter(
              (t: any) => !((reg.cancelled_tests || []) as any[]).some((c: any) => c.test_id === t.test_id)
            );

            return (
              <>
                <TableRow key={reg.id}
                  className={`cursor-pointer hover:bg-muted/50 ${reg.is_stat ? "bg-destructive/5 border-l-2 border-l-destructive" : ""}`}
                  onClick={() => setExpandedRow(isExpanded ? null : reg.id)}>
                  <TableCell>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold">{reg.invoice_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {reg.patient_name}
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                        </span>
                       )}
                       {reg.status === "repeat_collection" && (
                         <Badge variant="destructive" className="ml-2 text-xs">REPEAT</Badge>
                       )}
                     </div>
                  </TableCell>
                  <TableCell className="text-sm">{reg.mobile_number}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{getVisitLabel(reg.visit_type)}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {activeTests.length} tests • {groups.length} tube(s)
                    {isPending && groups.some(g => g.isCollected) && (
                      <span className="text-xs text-green-600 ml-1">
                        ({groups.filter(g => g.isCollected).length} done)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(isPending ? reg.created_at : reg.updated_at), "dd/MM/yy HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    {isPending ? (
                      <Button size="sm" variant="default" className="gap-1"
                        onClick={(e) => { e.stopPropagation(); toggleAllBarcodes(reg.id, groups, true); setExpandedRow(reg.id); }}>
                        <Printer className="h-3.5 w-3.5" /> Print All
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={(e) => { e.stopPropagation(); openReprintDialog(reg); }}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reprint
                      </Button>
                    )}
                  </TableCell>
                </TableRow>

                {isExpanded && (
                  <TableRow key={`${reg.id}-expand`}>
                    <TableCell colSpan={8} className="p-0">
                      {renderBarcodeExpansion(reg, groups, isPending)}
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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, mobile, invoice..." className="pl-8" />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setExpandedRow(null); }}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending <Badge variant="secondary" className="text-xs ml-1">{registrations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="collected" className="gap-1.5">
            Collected <Badge variant="secondary" className="text-xs ml-1">{collectedRegistrations.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-3">
          {renderTable(registrations, true, isLoading)}
        </TabsContent>
        <TabsContent value="collected" className="mt-3">
          {renderTable(collectedRegistrations, false, isLoadingCollected)}
        </TabsContent>
      </Tabs>

      {/* Reprint Dialog */}
      <Dialog open={reprintDialog.open} onOpenChange={(open) => { if (!open) setReprintDialog({ open: false, reg: null, groups: [] }); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reprint Barcodes</DialogTitle>
            <DialogDescription>
              Patient: <strong>{reprintDialog.reg?.patient_name}</strong> — {reprintDialog.reg?.invoice_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              {reprintDialog.groups.map((group, idx) => {
                const colorHex = getTubeColorHex(group.tubeColor);
                return (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded border">
                    <Checkbox checked={!!reprintSelectedBarcodes[idx]}
                      onCheckedChange={() => setReprintSelectedBarcodes(prev => ({ ...prev, [idx]: !prev[idx] }))} />
                    {colorHex && (
                      <span className="inline-block w-4 h-4 rounded-full border shrink-0"
                        style={{ backgroundColor: colorHex }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono font-bold text-sm">{group.sampleId}</span>
                      <Badge variant="outline" className="text-xs ml-2">
                        {group.sampleTube === "DEFAULT" ? "No Tube" : group.sampleTube}
                      </Badge>
                      <p className="text-xs text-muted-foreground truncate">{group.testNames.join(", ")}</p>
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
            <Button variant="outline" onClick={() => setReprintDialog({ open: false, reg: null, groups: [] })}>Cancel</Button>
            <Button className="gap-1" onClick={handleReprint}
              disabled={!reprintReason.trim() || !Object.values(reprintSelectedBarcodes).some(Boolean)}>
              <Printer className="h-3.5 w-3.5" /> Reprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={printRef} className="hidden" />
    </div>
  );
};

export default SampleCollection;
