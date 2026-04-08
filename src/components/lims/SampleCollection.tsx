import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Printer, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";

const TUBE_COLOR_MAP: Record<string, string> = {
  red: "#e53e3e", lavender: "#b794f4", purple: "#9f7aea", yellow: "#ecc94b",
  green: "#48bb78", blue: "#4299e1", grey: "#a0aec0", gray: "#a0aec0",
  white: "#ffffff", orange: "#ed8936", pink: "#ed64a6", black: "#1a202c",
};

interface BarcodeGroup {
  sampleId: string; // invoice + suffix
  sampleTube: string;
  tubeColor: string;
  sampleType: string;
  suffix: string;
  testNames: string[];
  selected: boolean;
}

const SampleCollection = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedBarcodes, setSelectedBarcodes] = useState<Record<string, Record<string, boolean>>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__scSearchTimeout);
    (window as any).__scSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch registered patients
  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["sample_collection_patients", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .eq("status", "registered")
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
      rows.sort((a: any, b: any) => {
        const aUrgent = a.is_stat ? 1 : 0;
        const bUrgent = b.is_stat ? 1 : 0;
        return bUrgent - aUrgent;
      });
      return rows;
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
  // Maps billing test_id -> suffix (if any parameter of that test has a suffix)
  const { data: testSuffixMap = {} } = useQuery({
    queryKey: ["test_suffix_map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, report_test_parameters!inner(custom_sample_suffix_enabled, custom_sample_suffix)")
        .eq("report_test_parameters.custom_sample_suffix_enabled", true);
      // Map by test_id to suffix
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

    // Group by sample_tube + suffix
    const groupMap: Record<string, BarcodeGroup> = {};

    for (const t of activeTests) {
      const testInfo = testsMap[t.test_id] || { sample_tube: "", tube_color: "", sample_type: "" };
      const tube = testInfo.sample_tube || "DEFAULT";
      const tubeColor = testInfo.tube_color || "";
      const sampleType = testInfo.sample_type || "";

      // Check if this test has a custom suffix from parameters (keyed by test_id)
      const suffix = testSuffixMap[t.test_id] || "";
      const groupKey = `${tube}||${suffix}`;

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          sampleId: suffix ? `${reg.invoice_number}${suffix}` : reg.invoice_number,
          sampleTube: tube,
          tubeColor,
          sampleType,
          suffix,
          testNames: [],
          selected: false,
        };
      }
      groupMap[groupKey].testNames.push(t.test_name);
    }

    return Object.values(groupMap);
  }, [testsMap, testSuffixMap]);

  // Get currently selected barcodes for a registration
  const getSelectedForReg = (regId: string, groups: BarcodeGroup[]) => {
    const sel = selectedBarcodes[regId] || {};
    return groups.map((g, i) => ({ ...g, selected: !!sel[i] }));
  };

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
      groups.forEach((_, i) => { regSel[i] = selectAll; });
      return { ...prev, [regId]: regSel };
    });
  };

  // Calculate age from dob
  const calcAge = (dob: string | null) => {
    if (!dob) return "";
    const birth = new Date(dob);
    const now = new Date();
    const years = now.getFullYear() - birth.getFullYear();
    return `${years} Yr(s)`;
  };

  // Print barcodes
  const printBarcodes = (reg: any, groups: BarcodeGroup[]) => {
    const sel = selectedBarcodes[reg.id] || {};
    const toPrint = groups.filter((_, i) => sel[i]);
    if (toPrint.length === 0) {
      toast.error("Please select at least one barcode to print");
      return;
    }

    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) {
      toast.error("Pop-up blocked. Please allow pop-ups.");
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
      // Create barcode SVG
      const canvas = document.createElement("canvas");
      try {
        JsBarcode(canvas, group.sampleId, {
          format: "CODE128",
          width: 1.5,
          height: 30,
          displayValue: false,
          margin: 0,
        });
      } catch {
        // fallback
      }
      const barcodeDataUrl = canvas.toDataURL("image/png");

      html += `<div class="label">
        <div class="row1">
          <span>${reg.invoice_number}</span>
          <span>${location ? `PH ${location}` : ""}</span>
        </div>
        <div class="row1" style="justify-content:space-between;">
          <span class="row2">${patientName}</span>
          <span style="font-size:6.5pt;">${age}${gender ? `/${gender}` : ""}</span>
        </div>
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
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  // Mark sample collected
  const markCollectedMutation = useMutation({
    mutationFn: async (regId: string) => {
      const { error } = await supabase
        .from("patient_registrations")
        .update({ status: "sample_collected" })
        .eq("id", regId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sample_collection_patients"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      toast.success("Status updated to Sample Collected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Print and mark collected
  const handlePrintAndCollect = (reg: any, groups: BarcodeGroup[]) => {
    const sel = selectedBarcodes[reg.id] || {};
    const selectedCount = groups.filter((_, i) => sel[i]).length;
    if (selectedCount === 0) {
      toast.error("Please select at least one barcode");
      return;
    }

    // Check if all barcodes are selected
    const allSelected = groups.every((_, i) => sel[i]);
    printBarcodes(reg, groups);

    if (allSelected) {
      markCollectedMutation.mutate(reg.id);
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, mobile, invoice..."
            className="pl-8"
          />
        </div>
        <Badge variant="outline">{registrations.length} patients pending</Badge>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : registrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No registered patients pending sample collection</p>
      ) : (
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
            {registrations.map((reg: any) => {
              const groups = buildBarcodeGroups(reg);
              const isExpanded = expandedRow === reg.id;
              const sel = selectedBarcodes[reg.id] || {};
              const selectedCount = groups.filter((_, i) => sel[i]).length;
              const activeTests = ((reg.tests || []) as any[]).filter(
                (t: any) => !((reg.cancelled_tests || []) as any[]).some((c: any) => c.test_id === t.test_id)
              );

              return (
                <>
                  <TableRow
                    key={reg.id}
                    className={`cursor-pointer hover:bg-muted/50 ${reg.is_stat ? "bg-destructive/5 border-l-2 border-l-destructive" : ""}`}
                    onClick={() => setExpandedRow(isExpanded ? null : reg.id)}
                  >
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
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{reg.mobile_number}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{getVisitLabel(reg.visit_type)}</Badge></TableCell>
                    <TableCell className="text-sm">{activeTests.length} tests • {groups.length} tube(s)</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(reg.created_at), "dd/MM/yy HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1"
                        onClick={(e) => { e.stopPropagation(); toggleAllBarcodes(reg.id, groups, true); setExpandedRow(reg.id); }}
                      >
                        <Printer className="h-3.5 w-3.5" /> Print All
                      </Button>
                    </TableCell>
                  </TableRow>

                  {isExpanded && (
                    <TableRow key={`${reg.id}-expand`}>
                      <TableCell colSpan={8} className="p-0">
                        <div className="bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold">Sample Barcodes</h4>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const allSel = groups.every((_, i) => sel[i]);
                                  toggleAllBarcodes(reg.id, groups, !allSel);
                                }}
                              >
                                {groups.every((_, i) => sel[i]) ? "Deselect All" : "Select All"}
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                className="gap-1"
                                disabled={selectedCount === 0}
                                onClick={() => handlePrintAndCollect(reg, groups)}
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Print Selected ({selectedCount})
                                {selectedCount === groups.length && " & Collect"}
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-2">
                            {groups.map((group, idx) => {
                              const colorHex = getTubeColorHex(group.tubeColor);
                              return (
                                <Card key={idx} className={`${sel[idx] ? "ring-2 ring-primary" : ""}`}>
                                  <CardContent className="p-3 flex items-center gap-3">
                                    <Checkbox
                                      checked={!!sel[idx]}
                                      onCheckedChange={() => toggleBarcode(reg.id, idx)}
                                    />
                                    {colorHex && (
                                      <span
                                        className="inline-block w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0"
                                        style={{ backgroundColor: colorHex }}
                                        title={group.tubeColor}
                                      />
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
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                        {group.testNames.join(", ")}
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedBarcodes(prev => ({
                                          ...prev,
                                          [reg.id]: { [idx]: true },
                                        }));
                                        printBarcodes(reg, [group]);
                                      }}
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                    </Button>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>

                          {selectedCount === groups.length && (
                            <Button
                              className="w-full gap-2"
                              onClick={() => markCollectedMutation.mutate(reg.id)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Mark as Sample Collected
                            </Button>
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
      <div ref={printRef} className="hidden" />
    </div>
  );
};

export default SampleCollection;
