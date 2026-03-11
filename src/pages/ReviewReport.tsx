import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, FileCheck, AlertTriangle, Trash2, Plus, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AddParameterToMasterDialog from "@/components/AddParameterToMasterDialog";
import { computeAbnormalFlag, normalizeTestResultFlags } from "@/lib/reportFlags";

interface TestResult {
  department?: string;
  profile_name?: string;
  test_name?: string;
  parameter_name: string;
  result_value: string;
  unit?: string;
  normal_range_low?: string;
  normal_range_high?: string;
  normal_range_text?: string;
  flag?: string;
  matched_parameter_id?: string;
}

const ReviewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [umrId, setUmrId] = useState("");
  const [refDoctor, setRefDoctor] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [pathologistName, setPathologistName] = useState("");
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [showUmrDialog, setShowUmrDialog] = useState(false);
  const [umrInput, setUmrInput] = useState("");
  const [pathologists, setPathologists] = useState<any[]>([]);
  const [selectedPathologist, setSelectedPathologist] = useState("");
  const [masterParams, setMasterParams] = useState<Map<string, { department_name?: string; profile_name?: string }>>(new Map());
  const [addParamDialogOpen, setAddParamDialogOpen] = useState(false);
  const [addParamIndex, setAddParamIndex] = useState<number | null>(null);
  

  useEffect(() => {
    loadData();
  }, [reportId]);

  const loadData = async () => {
    setLoading(true);
    const [{ data: extracted }, { data: sigs }, { data: params }, { data: depts }, { data: profiles }] = await Promise.all([
      supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single(),
      supabase.from("pathologist_signatures").select("*"),
      supabase.from("report_test_parameters").select("id, parameter_name, department_id, profile_id"),
      supabase.from("report_departments").select("id, department_name"),
      supabase.from("report_profiles").select("id, profile_name"),
    ]);

    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.department_name]));
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.profile_name]));

    const masterMap = new Map<string, { department_name?: string; profile_name?: string }>();
    (params || []).forEach((p: any) => {
      masterMap.set(p.parameter_name.toLowerCase(), {
        department_name: p.department_id ? deptMap.get(p.department_id) || "" : "",
        profile_name: p.profile_id ? profileMap.get(p.profile_id) || "" : "",
      });
    });
    setMasterParams(masterMap);

    if (extracted) {
      setExtractedData(extracted);
      setPatientName(extracted.patient_name || "");
      setAge(extracted.age || "");
      setGender(extracted.gender || "");
      setUmrId(extracted.umr_id || "");
      setRefDoctor(extracted.ref_doctor || "");
      setCollectionDate(extracted.collection_date || "");
      setReportDate(extracted.report_date || "");
      setPathologistName(extracted.pathologist_name || "");
      const rawResults = (extracted.test_results as unknown as TestResult[]) || [];
      // Auto-fill department and profile from master data
      const enrichedResults = rawResults.map((r) => {
        const master = masterMap.get(r.parameter_name.toLowerCase());
        // ONLY use department/profile from master parameters table, ignore AI-extracted values
        return {
          ...r,
          department: master ? master.department_name : "",
          profile_name: master ? master.profile_name : "",
        };
      });
      setTestResults(normalizeTestResultFlags(enrichedResults));
      if (!extracted.umr_id) setShowUmrDialog(true);
    }
    setPathologists(sigs || []);
    if (extracted?.pathologist_name && sigs?.length) {
      const match = sigs.find((s: any) => s.pathologist_name.toLowerCase().includes(extracted.pathologist_name?.toLowerCase() || ""));
      if (match) setSelectedPathologist(match.id);
    }
    setLoading(false);
  };

  const updateTestResult = (index: number, field: keyof TestResult, value: string) => {
    setTestResults((prev) => {
      const updated = prev.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      // Recalculate flag when result/range fields change
      if (field === "result_value" || field === "normal_range_low" || field === "normal_range_high" || field === "normal_range_text") {
        const row = updated[index];
        updated[index] = { ...row, flag: computeAbnormalFlag(row) };
      }
      return updated;
    });
  };

  const removeTestResult = (index: number) => {
    setTestResults((prev) => prev.filter((_, i) => i !== index));
  };

  const calculateFlags = (results: TestResult[]): TestResult[] => {
    return normalizeTestResultFlags(results);
  };

  const handleSaveAndGenerate = async () => {
    if (!umrId) {
      setShowUmrDialog(true);
      return;
    }
    const emptyDeptRows = testResults.filter((r, i) => !r.department?.trim());
    if (emptyDeptRows.length > 0) {
      toast({ title: "Department missing", description: `${emptyDeptRows.length} parameter(s) have no department. Add them to master data first.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const flaggedResults = calculateFlags(testResults);
      setTestResults(flaggedResults);

      // Update extracted data
      await supabase.from("extracted_report_data").update({
        patient_name: patientName,
        age,
        gender,
        umr_id: umrId,
        ref_doctor: refDoctor,
        collection_date: collectionDate,
        report_date: reportDate,
        pathologist_name: pathologistName,
        test_results: flaggedResults as unknown as any,
        verified: true,
      }).eq("report_id", reportId);

      // Upsert patient master
      const { data: existingPatient } = await supabase.from("patient_master").select("id").eq("umr_id", umrId).maybeSingle();
      if (existingPatient) {
        await supabase.from("patient_master").update({ patient_name: patientName, gender, age, last_visit_date: new Date().toISOString() }).eq("umr_id", umrId);
      } else {
        await supabase.from("patient_master").insert({ umr_id: umrId, patient_name: patientName, gender, age });
      }

      // Store analytics parameters in history
      const { data: analyticsParams } = await supabase.from("report_test_parameters").select("id, parameter_name").eq("store_for_analytics", true);
      const analyticsSet = new Set((analyticsParams || []).map((p: any) => p.parameter_name.toLowerCase()));

      const historyEntries = flaggedResults
        .filter((r) => {
          const numVal = parseFloat(r.result_value);
          return !isNaN(numVal) && (analyticsSet.size === 0 || analyticsSet.has(r.parameter_name.toLowerCase()));
        })
        .map((r) => ({
          umr_id: umrId,
          test_name: r.test_name || r.parameter_name,
          parameter_name: r.parameter_name,
          result_value: parseFloat(r.result_value),
          unit: r.unit || "",
          normal_range_low: parseFloat(r.normal_range_low || "") || null,
          normal_range_high: parseFloat(r.normal_range_high || "") || null,
          test_date: reportDate || new Date().toISOString(),
          department: r.department || "",
          profile_name: r.profile_name || "",
          report_id: reportId,
          flag: r.flag || "N",
        }));

      if (historyEntries.length > 0) {
        await supabase.from("test_result_history").insert(historyEntries);
      }

      // Update report status
      await supabase.from("uploaded_reports").update({
        status: "Completed",
        umr_id: umrId,
        patient_name: patientName,
      }).eq("id", reportId);

      toast({ title: "Report verified and saved!" });
      navigate(`/reports/view/${reportId}`);
    } catch (err: any) {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!extractedData) return <div className="p-8 text-center text-muted-foreground">No extracted data found for this report.</div>;

  const abnormalCount = testResults.filter((r) => r.flag === "H" || r.flag === "L").length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review Extracted Data</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/reports")}>Cancel</Button>
          <Button onClick={handleSaveAndGenerate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileCheck className="h-4 w-4 mr-2" />}
            Verify & Generate Report
          </Button>
        </div>
      </div>

      {abnormalCount > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <span className="font-medium text-destructive">{abnormalCount} abnormal result(s) detected</span>
        </div>
      )}

      {/* Patient Information */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Patient Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><Label>Patient Name</Label><Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} /></div>
            <div><Label>UMR ID</Label><Input value={umrId} onChange={(e) => setUmrId(e.target.value)} className={!umrId ? "border-destructive" : ""} /></div>
            <div><Label>Age</Label><Input value={age} onChange={(e) => setAge(e.target.value)} /></div>
            <div>
              <Label>Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Ref. Doctor</Label><Input value={refDoctor} onChange={(e) => setRefDoctor(e.target.value)} /></div>
            <div><Label>Collection Date</Label><Input value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} /></div>
            <div><Label>Report Date</Label><Input value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></div>
            <div>
              <Label>Pathologist</Label>
              <Select value={selectedPathologist} onValueChange={(v) => {
                setSelectedPathologist(v);
                const sig = pathologists.find((p) => p.id === v);
                if (sig) setPathologistName(sig.pathologist_name);
              }}>
                <SelectTrigger><SelectValue placeholder="Select pathologist" /></SelectTrigger>
                <SelectContent>
                  {pathologists.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.pathologist_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test Results ({testResults.length} parameters)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Department</TableHead>
                  <TableHead className="w-[120px]">Profile</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead className="w-[100px]">Result</TableHead>
                  <TableHead className="w-[80px]">Unit</TableHead>
                  <TableHead className="w-[120px]">Range</TableHead>
                  <TableHead className="w-[60px]">Flag</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead className="w-[50px]">Master</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testResults.map((r, i) => (
                  <TableRow key={i} className={r.flag === "H" || r.flag === "L" ? "bg-destructive/5" : ""}>
                    <TableCell>
                      <Input value={r.department || ""} readOnly className="h-8 text-xs bg-muted/50" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.profile_name || ""} readOnly className="h-8 text-xs bg-muted/50" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.parameter_name} onChange={(e) => updateTestResult(i, "parameter_name", e.target.value)} className="h-8 text-xs font-medium" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.result_value} onChange={(e) => updateTestResult(i, "result_value", e.target.value)} className={`h-8 text-xs font-bold ${r.flag === "H" || r.flag === "L" ? "text-destructive" : ""}`} />
                    </TableCell>
                    <TableCell>
                      <Input value={r.unit || ""} onChange={(e) => updateTestResult(i, "unit", e.target.value)} className="h-8 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`} onChange={(e) => updateTestResult(i, "normal_range_text", e.target.value)} className="h-8 text-xs" />
                    </TableCell>
                    <TableCell>
                      {r.flag === "H" && <Badge variant="destructive" className="text-xs">H</Badge>}
                      {r.flag === "L" && <Badge variant="destructive" className="text-xs">L</Badge>}
                      {r.flag === "N" && <Badge variant="secondary" className="text-xs">N</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeTestResult(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {masterParams.has(r.parameter_name.toLowerCase()) || r.matched_parameter_id ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 border-amber-400 text-amber-600 hover:bg-amber-50"
                                onClick={() => { setAddParamIndex(i); setAddParamDialogOpen(true); }}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {masterParams.has(r.parameter_name.toLowerCase()) || r.matched_parameter_id
                              ? "Exists in master data"
                              : "Not in master data — click to add"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* UMR Dialog */}
      <Dialog open={showUmrDialog} onOpenChange={setShowUmrDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>UMR Number Not Detected</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Please enter the patient's UMR (Unique Medical Record) number to continue.</p>
          <Input value={umrInput} onChange={(e) => setUmrInput(e.target.value.toUpperCase())} placeholder="e.g. UMR0001234" />
          <DialogFooter>
            <Button onClick={() => { setUmrId(umrInput); setShowUmrDialog(false); }} disabled={!umrInput}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Parameter to Master Dialog */}
      {addParamIndex !== null && (
        <AddParameterToMasterDialog
          open={addParamDialogOpen}
          onOpenChange={(v) => { setAddParamDialogOpen(v); if (!v) setAddParamIndex(null); }}
          parameterName={testResults[addParamIndex]?.parameter_name || ""}
          unit={testResults[addParamIndex]?.unit}
          department={testResults[addParamIndex]?.department}
          profileName={testResults[addParamIndex]?.profile_name}
          testName={testResults[addParamIndex]?.test_name}
          onAdded={(id) => {
            // Reload master data to get department/profile names for the newly added param
            loadData();
            setAddParamIndex(null);
          }}
        />
      )}
    </div>
  );
};

export default ReviewReport;
