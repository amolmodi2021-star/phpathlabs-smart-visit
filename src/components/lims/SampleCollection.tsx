import { useState, useRef, useCallback, useMemo } from "react";
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
import { recalculateRegistrationStatus } from "@/lib/limsStatus";

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
  const [activeTab, setActiveTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedTubes, setSelectedTubes] = useState<Record<string, Set<string>>>({});
  const printRef = useRef<HTMLDivElement>(null);

  // Reprint dialog state
  const [reprintDialog, setReprintDialog] = useState<{ open: boolean; reg: any; tubes: SampleTubeRow[] }>({ open: false, reg: null, tubes: [] });
  const [reprintReason, setReprintReason] = useState("");
  const [reprintSelectedTubes, setReprintSelectedTubes] = useState<Set<string>>(new Set());

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__scSearchTimeout);
    (window as any).__scSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch sample_tubes with pending or collected status - limited to last 14 days
  const { data: allTubes = [], isLoading } = useQuery({
    queryKey: ["sample_tubes_collection", debouncedSearch],
    queryFn: async () => {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const { data, error } = await supabase
        .from("sample_tubes" as any)
        .select("*")
        .in("status", ["pending", "collected"])
        .gte("created_at", fourteenDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as SampleTubeRow[];
    },
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

  // Fetch pickup points for location display
  const { data: pickupPoints = [] } = useQuery({
    queryKey: ["pickup_points_lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("pickup_points").select("id, name");
      return (data || []) as { id: string; name: string }[];
    },
  });
  const ppMap = Object.fromEntries(pickupPoints.map(p => [p.id, p.name]));

  // Group tubes by registration
  const pendingGroups = useMemo((): GroupedRegistration[] => {
    return registrations.filter(reg => {
      const tubes = allTubes.filter(t => t.registration_id === reg.id);
      return tubes.some(t => t.status === "pending");
    }).map(reg => ({
      registration: reg,
      tubes: allTubes.filter(t => t.registration_id === reg.id),
    }));
  }, [registrations, allTubes]);

  const collectedGroups = useMemo((): GroupedRegistration[] => {
    return registrations.filter(reg => {
      const tubes = allTubes.filter(t => t.registration_id === reg.id);
      return tubes.some(t => t.status === "collected");
    }).map(reg => ({
      registration: reg,
      tubes: allTubes.filter(t => t.registration_id === reg.id && t.status === "collected"),
    }));
  }, [registrations, allTubes]);

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

  // Print barcodes helper
  const doPrintBarcodes = (reg: any, tubes: SampleTubeRow[]): Promise<void> => {
    return new Promise((resolve) => {
      const printWindow = window.open("", "_blank", "width=400,height=600");
      if (!printWindow) { toast.error("Pop-up blocked. Please allow pop-ups."); resolve(); return; }

      const age = calcAge(reg.dob);
      const gender = reg.gender ? reg.gender.charAt(0) : "";
      const location = reg.pickup_point_id ? ppMap[reg.pickup_point_id] || "" : "";
      const dateTime = format(new Date(), "dd/MM/yy HH:mm a");
      const patientName = reg.patient_name || "";

      let html = `<!DOCTYPE html><html><head><style>
        @page { margin: 2mm; size: 50mm 25mm; }
        body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; }
        .label { width: 48mm; height: 23mm; padding: 1.5mm; box-sizing: border-box; page-break-after: always; position: relative; overflow: hidden; }
        .label:last-child { page-break-after: auto; }
        .row1 { display: flex; justify-content: space-between; font-size: 7pt; font-weight: bold; line-height: 1.2; }
        .row2 { font-size: 6.5pt; font-weight: bold; line-height: 1.2; margin-top: 0.5mm; }
        .barcode-wrap { text-align: center; margin: 0.5mm 0; }
        .barcode-wrap svg { width: 42mm; height: 8mm; }
        .sample-id { text-align: center; font-size: 7pt; font-weight: bold; line-height: 1; }
        .row-bottom { display: flex; justify-content: space-between; font-size: 6pt; line-height: 1.2; margin-top: 0.5mm; }
      </style></head><body>`;

      for (const tube of tubes) {
        // Barcode uses existing invoice-based sample ID for interfacing
        const barcodeValue = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;
        const canvas = document.createElement("canvas");
        try { JsBarcode(canvas, barcodeValue, { format: "CODE128", width: 1.5, height: 30, displayValue: false, margin: 0 }); } catch { /* fallback */ }
        const barcodeDataUrl = canvas.toDataURL("image/png");

        html += `<div class="label">
          <div class="row1"><span>${reg.invoice_number}</span><span>${age}${gender ? `/${gender}` : ""}</span></div>
          <div class="row2">${patientName}${location ? ` &nbsp; PH ${location}` : ""}</div>
          <div class="barcode-wrap"><img src="${barcodeDataUrl}" style="width:42mm;height:8mm;" /></div>
          <div class="sample-id">${barcodeValue} &nbsp; <small style="color:#888">${tube.sample_uid}</small></div>
          <div class="row-bottom">
            <span>${tube.sample_type || tube.tube_type || ""}</span>
            <span>${dateTime}</span>
          </div>
        </div>`;
      }

      html += "</body></html>";
      printWindow.document.write(html);
      printWindow.document.close();
      let resolved = false;
      const doResolve = () => { if (!resolved) { resolved = true; resolve(); } };
      printWindow.onafterprint = () => doResolve();
      printWindow.onload = () => { printWindow.print(); setTimeout(doResolve, 1000); };
      setTimeout(doResolve, 3000);
    });
  };

  // Mark tubes as collected
  const collectMutation = useMutation({
    mutationFn: async ({ regId, tubeIds }: { regId: string; tubeIds: string[] }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({ status: "collected", collected_at: now })
        .in("id", tubeIds);
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

  const handlePrintAndCollect = async (reg: any, tubes: SampleTubeRow[]) => {
    const regSel = selectedTubes[reg.id] || new Set();
    const toPrint = tubes.filter(t => t.status === "pending" && regSel.has(t.id));
    if (toPrint.length === 0) { toast.error("Please select at least one barcode"); return; }
    await doPrintBarcodes(reg, toPrint);
    collectMutation.mutate({ regId: reg.id, tubeIds: toPrint.map(t => t.id) });
  };

  const handleSinglePrintAndCollect = async (reg: any, tube: SampleTubeRow) => {
    await doPrintBarcodes(reg, [tube]);
    collectMutation.mutate({ regId: reg.id, tubeIds: [tube.id] });
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
          {isPending && pendingTubes.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => toggleAllPendingTubes(reg.id, tubes, !allPendingSelected)}>
                {allPendingSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button size="sm" variant="default" className="gap-1" disabled={selectedPendingCount === 0}
                onClick={() => handlePrintAndCollect(reg, tubes)}>
                <Printer className="h-3.5 w-3.5" /> Print & Collect ({selectedPendingCount})
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          {displayTubes.map((tube) => {
            const colorHex = getTubeColorHex(tube.tube_color);
            const isCollected = tube.status === "collected";
            const isSelected = regSel.has(tube.id);
            return (
              <Card key={tube.id} className={`${isCollected ? "opacity-60" : ""} ${isPending && !isCollected && isSelected ? "ring-2 ring-primary" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {isPending && !isCollected && (
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleTube(reg.id, tube.id)} />
                  )}
                  {colorHex && (
                    <span className="inline-block w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0"
                      style={{ backgroundColor: colorHex }} title={tube.tube_color || ""} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{tube.sample_uid}</span>
                      <Badge variant="outline" className="text-xs">
                        {(tube.tube_type || "DEFAULT") === "DEFAULT" ? "No Tube" : tube.tube_type}
                      </Badge>
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
                      {(tube.test_names || []).join(", ")}
                    </p>
                  </div>
                  {isPending && !isCollected && (
                    <Button size="sm" variant="ghost" className="shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleSinglePrintAndCollect(reg, tube); }}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
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
                      {reg.status === "repeat_collection" && <Badge variant="destructive" className="ml-2 text-xs">REPEAT</Badge>}
                      {isPending && collectedTubes.length > 0 && pendingTubes.length > 0 && (
                        <Badge className="ml-2 text-xs bg-amber-500 text-white border-0">PARTIAL</Badge>
                      )}
                    </div>
                  </TableCell>
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
                    <TableCell colSpan={8} className="p-0">
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
              Patient: <strong>{reprintDialog.reg?.patient_name}</strong> — {reprintDialog.reg?.invoice_number}
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
                      <span className="font-mono font-bold text-sm">{tube.sample_uid}</span>
                      <Badge variant="outline" className="text-xs ml-2">
                        {(tube.tube_type || "DEFAULT") === "DEFAULT" ? "No Tube" : tube.tube_type}
                      </Badge>
                      <p className="text-xs text-muted-foreground truncate">{(tube.test_names || []).join(", ")}</p>
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

      <div ref={printRef} className="hidden" />
    </div>
  );
};

export default SampleCollection;
