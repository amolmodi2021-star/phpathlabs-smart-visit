import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, ChevronDown, ChevronRight, Copy, RefreshCw, Link2, AlertTriangle, ChevronsUpDown, Check, Pencil, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface TestItem {
  code: string;
  name: string;
  unit: string;
  status: string;
  machine_id: string;
  machine_name: string;
}

const COMMON_TESTS: TestItem[] = [
  { code: "CBC", name: "Complete Blood Count", unit: "", status: "pending", machine_id: "", machine_name: "" },
  { code: "HB", name: "Hemoglobin", unit: "g/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "WBC", name: "White Blood Cell Count", unit: "cells/mcL", status: "pending", machine_id: "", machine_name: "" },
  { code: "PLT", name: "Platelet Count", unit: "cells/mcL", status: "pending", machine_id: "", machine_name: "" },
  { code: "RBC", name: "Red Blood Cell Count", unit: "million/mcL", status: "pending", machine_id: "", machine_name: "" },
  { code: "ESR", name: "Erythrocyte Sedimentation Rate", unit: "mm/hr", status: "pending", machine_id: "", machine_name: "" },
  { code: "FBS", name: "Fasting Blood Sugar", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "PPBS", name: "Post Prandial Blood Sugar", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "HBA1C", name: "Glycosylated Hemoglobin", unit: "%", status: "pending", machine_id: "", machine_name: "" },
  { code: "UREA", name: "Blood Urea", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "CREAT", name: "Serum Creatinine", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "URIC", name: "Uric Acid", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "CHOL", name: "Total Cholesterol", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "TG", name: "Triglycerides", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "LDL", name: "LDL Cholesterol", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "SGOT", name: "SGOT (AST)", unit: "U/L", status: "pending", machine_id: "", machine_name: "" },
  { code: "SGPT", name: "SGPT (ALT)", unit: "U/L", status: "pending", machine_id: "", machine_name: "" },
  { code: "TBIL", name: "Total Bilirubin", unit: "mg/dL", status: "pending", machine_id: "", machine_name: "" },
  { code: "TSH", name: "Thyroid Stimulating Hormone", unit: "mIU/L", status: "pending", machine_id: "", machine_name: "" },
];

const statusColor = (s: string) => {
  if (s === "completed") return "default";
  if (s === "in_progress") return "secondary";
  return "outline";
};

const LimsDemo = () => {
  const queryClient = useQueryClient();
  const [sampleId, setSampleId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [selectedTests, setSelectedTests] = useState<TestItem[]>([]);
  const [customCode, setCustomCode] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [customMachineId, setCustomMachineId] = useState("");
  const [customMachineName, setCustomMachineName] = useState("");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [mappingParamCode, setMappingParamCode] = useState<Record<string, string>>({});
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editingParamCode, setEditingParamCode] = useState<Record<string, string>>({});
  const [newMachineCode, setNewMachineCode] = useState("");
  const [newMachineId, setNewMachineId] = useState("");
  const [newParamCode, setNewParamCode] = useState("");

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "rpbkilhzulaugzrlatts";
  const apiUrl = `https://${projectId}.supabase.co/functions/v1/lims-interface`;

  // Realtime subscriptions
  useEffect(() => {
    const ch1 = supabase.channel("lims-orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lims_test_orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["lims-orders"] });
      }).subscribe();
    const ch2 = supabase.channel("lims-results-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lims_test_results" }, () => {
        queryClient.invalidateQueries({ queryKey: ["lims-results"] });
        queryClient.invalidateQueries({ queryKey: ["lims-orders"] });
      }).subscribe();
    const ch3 = supabase.channel("lims-logs-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lims_interface_logs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["lims-logs"] });
      }).subscribe();
    const ch4 = supabase.channel("lims-unmapped-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lims_unmapped_results" }, () => {
        queryClient.invalidateQueries({ queryKey: ["lims-unmapped"] });
      }).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); supabase.removeChannel(ch4); };
  }, [queryClient]);

  const { data: orders = [] } = useQuery({
    queryKey: ["lims-orders"],
    queryFn: async () => {
      const { data } = await supabase.from("lims_test_orders").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: results = [] } = useQuery({
    queryKey: ["lims-results"],
    queryFn: async () => {
      const { data } = await supabase.from("lims_test_results").select("*").order("received_at", { ascending: false });
      return data || [];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["lims-logs"],
    queryFn: async () => {
      const { data } = await supabase.from("lims_interface_logs").select("*").order("created_at", { ascending: false }).limit(100);
      return data || [];
    },
  });

  const { data: unmappedResults = [] } = useQuery({
    queryKey: ["lims-unmapped"],
    queryFn: async () => {
      const { data } = await supabase.from("lims_unmapped_results").select("*").eq("is_resolved", false).order("received_at", { ascending: false });
      return data || [];
    },
  });

  const { data: codeMappings = [] } = useQuery({
    queryKey: ["lims-code-mappings"],
    queryFn: async () => {
      const { data } = await supabase.from("lims_code_mapping").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: allParams = [] } = useQuery({
    queryKey: ["all-params-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase.from("report_test_parameters").select("id, param_code, parameter_name").order("parameter_name");
      return data || [];
    },
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!sampleId.trim()) throw new Error("Sample ID is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      const { error } = await supabase.from("lims_test_orders").insert([{
        sample_id: sampleId.trim(),
        patient_name: patientName.trim() || null,
        tests: selectedTests as any,
        status: "pending",
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Order created", description: `Sample ${sampleId} with ${selectedTests.length} tests` });
      setSampleId("");
      setPatientName("");
      setSelectedTests([]);
      queryClient.invalidateQueries({ queryKey: ["lims-orders"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteOrder = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("lims_test_results").delete().eq("order_id", id);
      const { error } = await supabase.from("lims_test_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lims-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lims-results"] });
    },
  });

  const clearLogs = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lims_interface_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lims-logs"] }),
  });

  const resolveUnmapped = useMutation({
    mutationFn: async ({ unmappedId, machineCode, machineId, paramCode, sampleId: sid, orderId, resultValue, unit, referenceRange, flag }: any) => {
      const param = allParams.find((p) => p.param_code === paramCode);
      if (!param) throw new Error("Parameter not found");

      // Insert code mapping (allow multiple param codes per machine_code)
      const { data: existingMap } = await supabase.from("lims_code_mapping")
        .select("id")
        .eq("machine_code", machineCode)
        .eq("machine_id", machineId || "")
        .eq("mapped_param_code", paramCode)
        .maybeSingle();
      if (!existingMap) {
        const { error: mapErr } = await supabase.from("lims_code_mapping").insert({
          machine_code: machineCode,
          machine_id: machineId || "",
          mapped_param_code: paramCode,
          parameter_name: param.parameter_name || "",
        });
        if (mapErr) throw mapErr;
      }

      // Move clicked result to lims_test_results
      const { error: resErr } = await supabase.from("lims_test_results").insert({
        order_id: orderId,
        sample_id: sid,
        test_code: paramCode,
        test_name: param.parameter_name || "",
        result_value: resultValue,
        unit: unit,
        reference_range: referenceRange,
        flag: flag,
      });
      if (resErr) throw resErr;

      // Mark clicked row as resolved
      const { error: resolveErr } = await supabase.from("lims_unmapped_results").update({ is_resolved: true }).eq("id", unmappedId);
      if (resolveErr) throw resolveErr;

      // Auto-resolve all other unmapped results with the same machine_code
      const { data: siblings } = await supabase.from("lims_unmapped_results")
        .select("*")
        .eq("machine_code", machineCode)
        .eq("is_resolved", false)
        .neq("id", unmappedId);
      
      if (siblings && siblings.length > 0) {
        // Insert each sibling's result into lims_test_results
        const siblingResults = siblings.map((s: any) => ({
          order_id: s.order_id,
          sample_id: s.sample_id,
          test_code: paramCode,
          test_name: param.parameter_name || "",
          result_value: s.result_value,
          unit: s.unit,
          reference_range: s.reference_range,
          flag: s.flag,
        }));
        await supabase.from("lims_test_results").insert(siblingResults);

        // Mark all siblings as resolved
        const siblingIds = siblings.map((s: any) => s.id);
        await supabase.from("lims_unmapped_results").update({ is_resolved: true }).in("id", siblingIds);
      }
    },
    onSuccess: () => {
      toast({ title: "Mapped & resolved", description: "Result moved to results table and mapping saved" });
      queryClient.invalidateQueries({ queryKey: ["lims-unmapped"] });
      queryClient.invalidateQueries({ queryKey: ["lims-code-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["lims-results"] });
      setMappingParamCode({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lims_code_mapping").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lims-code-mappings"] }),
  });

  const updateMapping = useMutation({
    mutationFn: async ({ id, paramCode }: { id: string; paramCode: string }) => {
      const param = allParams.find((p) => (p.param_code || p.id) === paramCode);
      const { error } = await supabase.from("lims_code_mapping").update({
        mapped_param_code: paramCode,
        parameter_name: param?.parameter_name || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Mapping updated" });
      queryClient.invalidateQueries({ queryKey: ["lims-code-mappings"] });
      setEditingMappingId(null);
      setEditingParamCode({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addMapping = useMutation({
    mutationFn: async ({ machineCode, machineId, paramCode }: { machineCode: string; machineId: string; paramCode: string }) => {
      const param = allParams.find((p) => (p.param_code || p.id) === paramCode);
      if (!param) throw new Error("Parameter not found");
      // Allow same machine_code with different mapped_param_code (1:N mapping)
      const { data: existingMap } = await supabase.from("lims_code_mapping")
        .select("id")
        .eq("machine_code", machineCode)
        .eq("machine_id", machineId || "")
        .eq("mapped_param_code", paramCode)
        .maybeSingle();
      if (existingMap) throw new Error("This exact mapping already exists");
      const { error } = await supabase.from("lims_code_mapping").insert({
        machine_code: machineCode,
        machine_id: machineId || "",
        mapped_param_code: paramCode,
        parameter_name: param.parameter_name || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Mapping added" });
      setNewMachineCode("");
      setNewMachineId("");
      setNewParamCode("");
      queryClient.invalidateQueries({ queryKey: ["lims-code-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["lims-unmapped"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleTest = (test: TestItem) => {
    setSelectedTests((prev) =>
      prev.find((t) => t.code === test.code)
        ? prev.filter((t) => t.code !== test.code)
        : [...prev, { ...test }]
    );
  };

  const addCustomTest = () => {
    if (!customCode.trim() || !customName.trim()) return;
    setSelectedTests((prev) => [
      ...prev,
      { code: customCode.trim(), name: customName.trim(), unit: customUnit.trim(), status: "pending", machine_id: customMachineId.trim(), machine_name: customMachineName.trim() },
    ]);
    setCustomCode("");
    setCustomName("");
    setCustomUnit("");
    setCustomMachineId("");
    setCustomMachineName("");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const orderResults = (orderId: string) => results.filter((r) => r.order_id === orderId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">LIMS Bidirectional Interface — Demo</h1>
        <p className="text-muted-foreground text-sm">Create test orders and monitor middleware communication in real-time</p>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders & Results</TabsTrigger>
          <TabsTrigger value="logs">Interface Logs ({logs.length})</TabsTrigger>
          <TabsTrigger value="mapping">
            Code Mapping
            {unmappedResults.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">{unmappedResults.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        {/* ───── ORDERS TAB ───── */}
        <TabsContent value="orders" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Create Test Order</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Sample ID / Barcode *" value={sampleId} onChange={(e) => setSampleId(e.target.value)} />
                <Input placeholder="Patient Name (optional)" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Select Tests</p>
                <div className="flex flex-wrap gap-2">
                  {COMMON_TESTS.map((t) => (
                    <Badge
                      key={t.code}
                      variant={selectedTests.find((s) => s.code === t.code) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTest(t)}
                    >
                      {t.code}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 items-end flex-wrap">
                <Input placeholder="Code" value={customCode} onChange={(e) => setCustomCode(e.target.value)} className="w-24" />
                <Input placeholder="Test Name" value={customName} onChange={(e) => setCustomName(e.target.value)} className="flex-1 min-w-[120px]" />
                <Input placeholder="Unit" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} className="w-24" />
                <Input placeholder="Machine ID" value={customMachineId} onChange={(e) => setCustomMachineId(e.target.value)} className="w-28" />
                <Input placeholder="Machine Name" value={customMachineName} onChange={(e) => setCustomMachineName(e.target.value)} className="w-36" />
                <Button size="sm" variant="outline" onClick={addCustomTest}><Plus className="h-4 w-4" /></Button>
              </div>

              {selectedTests.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  Selected: {selectedTests.map((t) => t.code).join(", ")} ({selectedTests.length} tests)
                </div>
              )}

              <Button onClick={() => createOrder.mutate()} disabled={createOrder.isPending}>
                {createOrder.isPending ? "Creating..." : "Create Order"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Active Orders ({orders.length})</CardTitle></CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet. Create one above.</p>
              ) : (
                <div className="space-y-2">
                  {orders.map((order) => {
                    const tests = (order.tests as any as TestItem[]) || [];
                    const oResults = orderResults(order.id);
                    const isExpanded = expandedOrder === order.id;
                    return (
                      <Collapsible key={order.id} open={isExpanded} onOpenChange={() => setExpandedOrder(isExpanded ? null : order.id)}>
                        <div className="border rounded-lg p-3">
                          <CollapsibleTrigger className="w-full">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <span className="font-mono font-medium">{order.sample_id}</span>
                                {order.patient_name && <span className="text-muted-foreground text-sm">{order.patient_name}</span>}
                                <Badge variant={statusColor(order.status)}>{order.status}</Badge>
                                <span className="text-xs text-muted-foreground">{tests.length} tests, {oResults.length} results</span>
                              </div>
                              <Button
                                size="icon" variant="ghost"
                                onClick={(e) => { e.stopPropagation(); deleteOrder.mutate(order.id); }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Code</TableHead>
                                  <TableHead>Test Name</TableHead>
                                  <TableHead>Unit</TableHead>
                                  <TableHead>Machine ID</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Result</TableHead>
                                  <TableHead>Flag</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tests.map((t, i) => {
                                  const res = oResults.find((r) => r.test_code === t.code);
                                  return (
                                    <TableRow key={i}>
                                      <TableCell className="font-mono">{t.code}</TableCell>
                                      <TableCell>{t.name}</TableCell>
                                      <TableCell>{res?.unit || t.unit}</TableCell>
                                      <TableCell className="font-mono text-xs">{t.machine_id || "—"}</TableCell>
                                      <TableCell><Badge variant={statusColor(t.status)} className="text-xs">{t.status}</Badge></TableCell>
                                      <TableCell className="font-mono">{res?.result_value || "—"}</TableCell>
                                      <TableCell>{res?.flag && <Badge variant={res.flag === "Abnormal" ? "destructive" : "outline"} className="text-xs">{res.flag}</Badge>}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── LOGS TAB ───── */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Interface Logs</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["lims-logs"] })}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => clearLogs.mutate()}>Clear All</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No logs yet. Middleware interactions will appear here.</p>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {logs.map((log) => (
                    <div key={log.id} className="border rounded p-3 text-sm space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={log.direction === "incoming" ? "default" : "secondary"}>{log.direction}</Badge>
                        <Badge variant="outline">{log.event_type}</Badge>
                        <span className="font-mono text-xs">{log.sample_id}</span>
                        {(log as any).machine_id && (
                          <Badge variant="secondary" className="text-xs font-mono">🖥 {(log as any).machine_id}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">Request / Response</summary>
                        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(log.request_body, null, 2)}</pre>
                        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(log.response_body, null, 2)}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── CODE MAPPING TAB ───── */}
        <TabsContent value="mapping" className="space-y-6">
          {/* Unmapped Results */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Unmapped Results ({unmappedResults.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unmappedResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No unmapped results. All incoming codes are mapped correctly.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sample ID</TableHead>
                      <TableHead>Machine Code</TableHead>
                      <TableHead>Machine ID</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Flag</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Map To Parameter</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmappedResults.map((ur) => (
                      <TableRow key={ur.id}>
                        <TableCell className="font-mono text-xs">{ur.sample_id}</TableCell>
                        <TableCell className="font-mono font-medium">{ur.machine_code}</TableCell>
                        <TableCell className="font-mono text-xs">{ur.machine_id || "—"}</TableCell>
                        <TableCell className="font-mono">{ur.result_value}</TableCell>
                        <TableCell>{ur.unit}</TableCell>
                        <TableCell>
                          <Badge variant={ur.flag === "Abnormal" ? "destructive" : "outline"} className="text-xs">{ur.flag}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{new Date(ur.received_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="w-56 h-8 text-xs justify-between font-normal">
                                {mappingParamCode[ur.id]
                                  ? allParams.find((p) => (p.param_code || p.id) === mappingParamCode[ur.id])
                                    ? `${mappingParamCode[ur.id]} — ${allParams.find((p) => (p.param_code || p.id) === mappingParamCode[ur.id])?.parameter_name}`
                                    : mappingParamCode[ur.id]
                                  : "Search parameter..."}
                                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search by code or name..." className="h-8 text-xs" />
                                <CommandList className="max-h-48">
                                  <CommandEmpty className="py-2 text-xs">No parameter found.</CommandEmpty>
                                  {allParams.map((p) => {
                                    const val = p.param_code || p.id;
                                    return (
                                      <CommandItem
                                        key={p.id}
                                        value={`${p.param_code} ${p.parameter_name}`}
                                        onSelect={() => setMappingParamCode((prev) => ({ ...prev, [ur.id]: val }))}
                                        className="text-xs"
                                      >
                                        <Check className={`mr-1 h-3 w-3 ${mappingParamCode[ur.id] === val ? "opacity-100" : "opacity-0"}`} />
                                        <span className="font-mono">{p.param_code}</span>
                                        <span className="mx-1">—</span>
                                        <span className="truncate">{p.parameter_name}</span>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={!mappingParamCode[ur.id] || resolveUnmapped.isPending}
                            onClick={() => resolveUnmapped.mutate({
                              unmappedId: ur.id,
                              machineCode: ur.machine_code,
                              machineId: ur.machine_id,
                              paramCode: mappingParamCode[ur.id],
                              sampleId: ur.sample_id,
                              orderId: ur.order_id,
                              resultValue: ur.result_value,
                              unit: ur.unit,
                              referenceRange: ur.reference_range,
                              flag: ur.flag,
                            })}
                          >
                            <Link2 className="h-3 w-3 mr-1" /> Map
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Add Mapping Manually */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Mapping Manually
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Machine Code *</label>
                  <Input
                    value={newMachineCode}
                    onChange={(e) => setNewMachineCode(e.target.value)}
                    placeholder="e.g. WBC, RBC#"
                    className="h-9 w-40 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Machine ID (optional)</label>
                  <Input
                    value={newMachineId}
                    onChange={(e) => setNewMachineId(e.target.value)}
                    placeholder="e.g. INDIKO"
                    className="h-9 w-40 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Parameter *</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-72 h-9 text-xs justify-between font-normal">
                        {newParamCode
                          ? allParams.find((p) => (p.param_code || p.id) === newParamCode)
                            ? `${newParamCode} — ${allParams.find((p) => (p.param_code || p.id) === newParamCode)?.parameter_name}`
                            : newParamCode
                          : "Search parameter..."}
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search by code or name..." className="h-8 text-xs" />
                        <CommandList className="max-h-48">
                          <CommandEmpty className="py-2 text-xs">No parameter found.</CommandEmpty>
                          {allParams.map((p) => {
                            const val = p.param_code || p.id;
                            return (
                              <CommandItem
                                key={p.id}
                                value={`${p.param_code} ${p.parameter_name}`}
                                onSelect={() => setNewParamCode(val)}
                                className="text-xs"
                              >
                                <Check className={`mr-1 h-3 w-3 ${newParamCode === val ? "opacity-100" : "opacity-0"}`} />
                                <span className="font-mono">{p.param_code}</span>
                                <span className="mx-1">—</span>
                                <span className="truncate">{p.parameter_name}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <Button
                  size="sm"
                  className="h-9"
                  disabled={!newMachineCode.trim() || !newParamCode || addMapping.isPending}
                  onClick={() => addMapping.mutate({
                    machineCode: newMachineCode.trim(),
                    machineId: newMachineId.trim(),
                    paramCode: newParamCode,
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Mapping
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Manually pair an analyzer's machine code with an existing parameter. If the same Machine Code + Machine ID already exists, it will be updated.
              </p>
            </CardContent>
          </Card>

          {/* Existing Mappings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Code Mappings ({codeMappings.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {codeMappings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No mappings configured yet. Map unmapped results above or they'll be auto-used for future results.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine Code</TableHead>
                      <TableHead>Machine ID</TableHead>
                      <TableHead>→ Param Code</TableHead>
                      <TableHead>Parameter Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codeMappings.map((m) => {
                      const isEditing = editingMappingId === m.id;
                      const selectedCode = editingParamCode[m.id];
                      const selectedParam = selectedCode ? allParams.find((p) => (p.param_code || p.id) === selectedCode) : null;
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono font-medium">{m.machine_code}</TableCell>
                          <TableCell className="font-mono text-xs">{m.machine_id || "—"}</TableCell>
                          {isEditing ? (
                            <TableCell colSpan={2}>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="w-64 h-8 text-xs justify-between font-normal">
                                    {selectedParam
                                      ? `${selectedCode} — ${selectedParam.parameter_name}`
                                      : "Search parameter..."}
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search by code or name..." className="h-8 text-xs" />
                                    <CommandList className="max-h-48">
                                      <CommandEmpty>No parameter found.</CommandEmpty>
                                      {allParams.map((p) => {
                                        const val = p.param_code || p.id;
                                        return (
                                          <CommandItem
                                            key={p.id}
                                            value={`${p.param_code} ${p.parameter_name}`}
                                            onSelect={() => setEditingParamCode((prev) => ({ ...prev, [m.id]: val }))}
                                            className="text-xs"
                                          >
                                            <Check className={`mr-1 h-3 w-3 ${selectedCode === val ? "opacity-100" : "opacity-0"}`} />
                                            <span className="font-mono">{p.param_code}</span>
                                            <span className="mx-1">—</span>
                                            <span className="truncate">{p.parameter_name}</span>
                                          </CommandItem>
                                        );
                                      })}
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                          ) : (
                            <>
                              <TableCell className="font-mono">{m.mapped_param_code || m.mapped_test_code}</TableCell>
                              <TableCell>{m.parameter_name}</TableCell>
                            </>
                          )}
                          <TableCell className="text-xs">{new Date(m.created_at).toLocaleString()}</TableCell>
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" disabled={!selectedCode || updateMapping.isPending} onClick={() => updateMapping.mutate({ id: m.id, paramCode: selectedCode })}>
                                  <Check className="h-4 w-4 text-primary" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => { setEditingMappingId(null); setEditingParamCode({}); }}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => { setEditingMappingId(m.id); setEditingParamCode({ [m.id]: m.mapped_param_code || m.mapped_test_code || "" }); }}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteMapping.mutate(m.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── API REFERENCE TAB ───── */}
        <TabsContent value="api">
          <Card>
            <CardHeader><CardTitle className="text-base">API Reference for Middleware</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Base URL</h3>
                <div className="flex items-center gap-2 bg-muted p-2 rounded">
                  <code className="text-sm flex-1 break-all">{apiUrl}</code>
                  <Button size="icon" variant="ghost" onClick={() => copyToClipboard(apiUrl)}><Copy className="h-4 w-4" /></Button>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">1. Query Tests (Middleware → App)</h3>
                <p className="text-sm text-muted-foreground mb-2">When middleware scans a barcode, call this to get the list of tests to process. Optionally pass <code>machine_id</code> to filter tests for a specific machine.</p>
                <div className="bg-muted p-3 rounded space-y-2">
                  <code className="text-sm block">GET {apiUrl}?action=query&sample_id=BARCODE123&machine_id=MACH001</code>
                  <p className="text-xs text-muted-foreground">• <code>machine_id</code> is optional — if provided, only tests assigned to that machine are returned</p>
                  <p className="text-xs font-medium mt-2">Response:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    order_id: "uuid",
                    sample_id: "BARCODE123",
                    patient_name: "John Doe",
                    tests: [
                      { code: "CBC", name: "Complete Blood Count", unit: "", machine_id: "MACH001" },
                    ],
                  }, null, 2)}</pre>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">2. Submit Results (Middleware → App)</h3>
                <p className="text-sm text-muted-foreground mb-2">After processing, send results back. Codes are auto-mapped via the Code Mapping table. Unmapped codes are stored separately for manual mapping.</p>
                <div className="bg-muted p-3 rounded space-y-2">
                  <code className="text-sm block">POST {apiUrl}</code>
                  <p className="text-xs font-medium mt-2">Request Body:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    action: "results",
                    sample_id: "BARCODE123",
                    machine_id: "MACH001",
                    results: [
                      { code: "HB_MACHINE", name: "Hemoglobin", value: "13.5", unit: "g/dL", reference_range: "12-16", flag: "Normal" },
                    ],
                  }, null, 2)}</pre>
                  <p className="text-xs font-medium mt-2">Response:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    success: true,
                    sample_id: "BARCODE123",
                    results_received: 1,
                    mapped: 1,
                    unmapped: 0,
                    order_id: "uuid",
                  }, null, 2)}</pre>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Headers</h3>
                <div className="bg-muted p-3 rounded text-sm">
                  <p><code>Content-Type: application/json</code></p>
                  <p className="text-muted-foreground text-xs mt-1">No authentication required — endpoints are open for middleware access.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LimsDemo;
