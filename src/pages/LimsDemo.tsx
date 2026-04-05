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
import { Plus, Trash2, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TestItem {
  code: string;
  name: string;
  unit: string;
  status: string;
}

const COMMON_TESTS: TestItem[] = [
  { code: "CBC", name: "Complete Blood Count", unit: "", status: "pending" },
  { code: "HB", name: "Hemoglobin", unit: "g/dL", status: "pending" },
  { code: "WBC", name: "White Blood Cell Count", unit: "cells/mcL", status: "pending" },
  { code: "PLT", name: "Platelet Count", unit: "cells/mcL", status: "pending" },
  { code: "RBC", name: "Red Blood Cell Count", unit: "million/mcL", status: "pending" },
  { code: "ESR", name: "Erythrocyte Sedimentation Rate", unit: "mm/hr", status: "pending" },
  { code: "FBS", name: "Fasting Blood Sugar", unit: "mg/dL", status: "pending" },
  { code: "PPBS", name: "Post Prandial Blood Sugar", unit: "mg/dL", status: "pending" },
  { code: "HBA1C", name: "Glycosylated Hemoglobin", unit: "%", status: "pending" },
  { code: "UREA", name: "Blood Urea", unit: "mg/dL", status: "pending" },
  { code: "CREAT", name: "Serum Creatinine", unit: "mg/dL", status: "pending" },
  { code: "URIC", name: "Uric Acid", unit: "mg/dL", status: "pending" },
  { code: "CHOL", name: "Total Cholesterol", unit: "mg/dL", status: "pending" },
  { code: "TG", name: "Triglycerides", unit: "mg/dL", status: "pending" },
  { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", status: "pending" },
  { code: "LDL", name: "LDL Cholesterol", unit: "mg/dL", status: "pending" },
  { code: "SGOT", name: "SGOT (AST)", unit: "U/L", status: "pending" },
  { code: "SGPT", name: "SGPT (ALT)", unit: "U/L", status: "pending" },
  { code: "TBIL", name: "Total Bilirubin", unit: "mg/dL", status: "pending" },
  { code: "TSH", name: "Thyroid Stimulating Hormone", unit: "mIU/L", status: "pending" },
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
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

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
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); };
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

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!sampleId.trim()) throw new Error("Sample ID is required");
      if (selectedTests.length === 0) throw new Error("Select at least one test");
      const { error } = await supabase.from("lims_test_orders").insert({
        sample_id: sampleId.trim(),
        patient_name: patientName.trim() || null,
        tests: selectedTests,
        status: "pending",
      });
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
      { code: customCode.trim(), name: customName.trim(), unit: customUnit.trim(), status: "pending" },
    ]);
    setCustomCode("");
    setCustomName("");
    setCustomUnit("");
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
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        {/* ───── ORDERS TAB ───── */}
        <TabsContent value="orders" className="space-y-6">
          {/* Create Order */}
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

              <div className="flex gap-2 items-end">
                <Input placeholder="Code" value={customCode} onChange={(e) => setCustomCode(e.target.value)} className="w-24" />
                <Input placeholder="Test Name" value={customName} onChange={(e) => setCustomName(e.target.value)} className="flex-1" />
                <Input placeholder="Unit" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} className="w-24" />
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

          {/* Active Orders */}
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
                      <div className="flex items-center gap-2">
                        <Badge variant={log.direction === "incoming" ? "default" : "secondary"}>{log.direction}</Badge>
                        <Badge variant="outline">{log.event_type}</Badge>
                        <span className="font-mono text-xs">{log.sample_id}</span>
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
                <p className="text-sm text-muted-foreground mb-2">When middleware scans a barcode, call this to get the list of tests to process.</p>
                <div className="bg-muted p-3 rounded space-y-2">
                  <code className="text-sm block">GET {apiUrl}?action=query&sample_id=BARCODE123</code>
                  <p className="text-xs font-medium mt-2">Response:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    order_id: "uuid",
                    sample_id: "BARCODE123",
                    patient_name: "John Doe",
                    tests: [{ code: "CBC", name: "Complete Blood Count", unit: "" }, { code: "FBS", name: "Fasting Blood Sugar", unit: "mg/dL" }],
                  }, null, 2)}</pre>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">2. Submit Results (Middleware → App)</h3>
                <p className="text-sm text-muted-foreground mb-2">After processing, send results back to the app.</p>
                <div className="bg-muted p-3 rounded space-y-2">
                  <code className="text-sm block">POST {apiUrl}</code>
                  <p className="text-xs font-medium mt-2">Request Body:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    action: "results",
                    sample_id: "BARCODE123",
                    results: [
                      { code: "CBC", name: "Complete Blood Count", value: "Normal", unit: "", reference_range: "", flag: "Normal" },
                      { code: "FBS", name: "Fasting Blood Sugar", value: "95", unit: "mg/dL", reference_range: "70-110", flag: "Normal" },
                    ],
                  }, null, 2)}</pre>
                  <p className="text-xs font-medium mt-2">Response:</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify({
                    success: true,
                    sample_id: "BARCODE123",
                    results_received: 2,
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
