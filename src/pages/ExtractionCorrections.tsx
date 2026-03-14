import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Plus, Eye, EyeOff, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

const buildPromptPreview = (
  corrections: { parameter_name: string; field_corrected: string; original_value: string | null; corrected_value: string | null }[],
  parameters: { parameter_name: string; unit: string | null; normal_range_low: number | null; normal_range_high: number | null; department_name?: string; profile_name?: string }[]
) => {
  // Build corrections block (same logic as edge function)
  let correctionsBlock = "";
  if (corrections.length > 0) {
    const seen = new Set<string>();
    const unique: typeof corrections = [];
    for (const c of corrections) {
      const key = `${c.parameter_name}|${c.field_corrected}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }
    correctionsBlock = unique.slice(0, 50).map(
      (c) => `- Parameter "${c.parameter_name}": ${c.field_corrected} should be "${c.corrected_value}" not "${c.original_value}"`
    ).join("\n");
  }

  const paramList = parameters.map(
    (p) => `${p.parameter_name}|${p.unit || ""}|${p.normal_range_low ?? ""}|${p.normal_range_high ?? ""}|${p.department_name || ""}|${p.profile_name || ""}`
  ).join("\n");

  return `You are an advanced pathology report extraction engine.

RELIABILITY MODE (STRICT):
1) Use TEXT LAYER as primary signal whenever available. Use image only for validation or missing text.
2) Extract row-by-row. Keep Test Name -> Result -> Unit -> Reference Range from the same row.
3) Prevent numeric collisions: result must be closest numeric token after test name, before reference range.
4) For each extracted result return:
   - source_page (page number where row was read)
   - confidence_score (0-100)
   - extraction_basis (text_layer | vision | hybrid)
5) If uncertain, keep confidence low (<80). Do not hallucinate.
6) If a field is missing, return empty string/null instead of guessing.

CRITICAL - EXTRACT ALL PARAMETERS INCLUDING QUALITATIVE/TEXT RESULTS:
- You MUST extract EVERY parameter row from ALL sections including:
  * PHYSICAL EXAMINATION (Quantity, Colour, Appearance, pH, Specific Gravity)
  * CHEMICAL EXAMINATION (Proteins, Glucose, Ketone Bodies, Bilirubin, Blood, Nitrite, Urobilinogen)
  * MICROSCOPIC EXAMINATION (Pus cells, Red Blood Cells, Epithelial cells, Casts, Crystals, Yeast Cells, Bacteria, Mucus Threads, Trichomonas Vaginalis, Spermatozoa, Deposit)
- Text/qualitative results like "Absent", "Nil", "Negative", "Clear", "Pale yellow", "1-2/hpf" are VALID result_value entries. Do NOT skip them.
- For qualitative results, set flag to "N" (normal).
- Urine reports often have key-value table formats (Parameter | Result | Reference). Extract ALL rows.
- Do NOT skip any row just because it has a non-numeric result.

PATIENT DEMOGRAPHICS:
- Extract: name, age, gender, UMR ID (strictly UMR-labeled only), ref doctor, collection/report dates
- Also extract: Reg.No, Reg.Date, Sample Collection Date/Time, Accession Date, Authentication Date, Print Date, Location

UMR RULE:
- Only capture umr_id if explicitly labeled UMR/UMR ID/Unique Medical Record.
- Do not use Reg.No, invoice, bill or lab numbers as UMR.

DATE RULE:
- If sample_collection_date exists, copy it to collection_date when collection_date is empty.
- If authentication_date/report date exists, ensure report_date is filled.

PATHOLOGIST / APPROVED BY RULE (CRITICAL):
- Pathology reports often have MULTIPLE doctors approving different sections/tests.
- Each page or section may have a DIFFERENT doctor's name near the signature/approval area.
- Look at EACH PAGE carefully for doctor names near "Section approved by", "Pathologist", "Dr.", signature blocks.
- For EACH test result, set approved_by to the doctor whose name appears on the SAME PAGE as that test result.
- If a page has one doctor's name at the bottom, ALL tests on that page are approved by that doctor.
- If different sections on the same page have different doctors, attribute tests to the nearest doctor.
- Do NOT assign the same doctor to all tests unless genuinely only one doctor signed the entire report.
- Return the full doctor name including title (e.g., "Dr. JOHN SMITH").

REFERENCE RANGE RULE (CRITICAL):
- Many parameters have advisory-style reference ranges with multiple categories (e.g., Vitamin D: Deficiency/Insufficiency/Sufficiency/Toxicity, or HDL Cholesterol: No Risk/Moderate Risk/High Risk).
- You MUST extract the COMPLETE reference range text including ALL categories, not just one line.
- Example: For HDL Cholesterol, extract "No Risk: >60 mg/dL, Moderate Risk: 40-60 mg/dL, High Risk: <40 mg/dL" — NOT just "Moderate Risk 40-60 mg/dL".
- Example: For Vitamin D, extract "Deficiency: <10 ng/mL, Insufficiency: 10-30 ng/mL, Sufficiency: 30-100 ng/mL, Toxicity: >100 ng/mL".
- Example: For HbA1c-Glycated Haemoglobin, the reference range is "Non-Diabetic: <= 5.6%, Pre-Diabetic: 5.7 - 6.4%, Diabetic: >= 6.5% (American Diabetes Association guideline 2019)". Set normal_range_high=5.6, normal_range_low=null (Non-Diabetic upper bound). Any value > 5.6 MUST be flagged H.
- CRITICAL: For HbA1c and similar diabetes markers, the NORMAL upper bound is the Non-Diabetic threshold (e.g., 5.6). Any value above this MUST be flagged as H.
- Put the full multi-line reference text in normal_range_text.
- For normal_range_low and normal_range_high, use the "normal/non-diabetic/sufficient/no-risk" category bounds.

ABNORMAL FLAG RULE:
- Compare numeric result with normal_range_low/high:
  > high => H, < low => L, else N.
- For qualitative results (Absent, Nil, Negative, etc.), set flag to "N".

KNOWN PARAMETERS:
${paramList || "No parameters configured yet"}

${correctionsBlock ? `LEARNED CORRECTIONS (from past user fixes — apply these patterns to avoid repeating mistakes):
${correctionsBlock}` : "(No learned corrections yet)"}

PROFILE MAPPING RULE (CRITICAL FOR DISAMBIGUATION):
- The KNOWN PARAMETERS list includes a "profile" column. Use it to set profile_name for each extracted row.
- Section headers like "STOOL EXAMINATION", "URINE EXAMINATION" should map to the closest known profile name from the list.
- This is critical for disambiguating parameters with identical names across different test sections (e.g., "Colour" in Stool vs Urine).

MATCHING:
- Fuzzy match abbreviations (CBC, LFT, KFT, TFT).
- Prefer closest known parameter name and return matched_parameter_id if known.`;
};

const ExtractionCorrections = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [newParam, setNewParam] = useState("");
  const [newField, setNewField] = useState("parameter_name");
  const [newOriginal, setNewOriginal] = useState("");
  const [newCorrected, setNewCorrected] = useState("");
  const queryClient = useQueryClient();

  const { data: corrections = [], isLoading } = useQuery({
    queryKey: ["extraction-corrections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_corrections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: parameters = [] } = useQuery({
    queryKey: ["prompt-parameters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_test_parameters")
        .select("parameter_name, unit, normal_range_low, normal_range_high, report_departments(department_name), report_profiles(profile_name)")
        .order("parameter_name");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        parameter_name: p.parameter_name,
        unit: p.unit,
        normal_range_low: p.normal_range_low,
        normal_range_high: p.normal_range_high,
        department_name: p.report_departments?.department_name || "",
        profile_name: p.report_profiles?.profile_name || "",
      }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("extraction_corrections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "Correction deleted" });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("extraction_corrections").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "All corrections cleared" });
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("extraction_corrections").insert({
        parameter_name: newParam,
        field_corrected: newField,
        original_value: newOriginal || null,
        corrected_value: newCorrected || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      toast({ title: "Correction added" });
      setAddOpen(false);
      setNewParam("");
      setNewField("parameter_name");
      setNewOriginal("");
      setNewCorrected("");
    },
  });

  const promptText = buildPromptPreview(corrections, parameters);

  const copyPrompt = () => {
    navigator.clipboard.writeText(promptText);
    toast({ title: "Prompt copied to clipboard" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Extraction Corrections</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Correction
          </Button>
          {corrections.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => clearAllMutation.mutate()} disabled={clearAllMutation.isPending}>
              Clear All
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        These corrections are fed into the AI prompt to improve future extractions. Total: {corrections.length}
      </p>

      {/* AI Prompt Preview Section */}
      <Card>
        <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">AI Extraction Prompt Preview</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyPrompt}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {promptOpen ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                    {promptOpen ? "Hide" : "View"} Prompt
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the system prompt sent to the AI during report extraction, including {parameters.length} known parameters and {corrections.length} learned corrections.
            </p>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs font-mono bg-muted p-4 rounded-md max-h-[500px] overflow-y-auto border">
                {promptText}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Manual Correction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Parameter Name</Label>
              <Input value={newParam} onChange={(e) => setNewParam(e.target.value)} placeholder="e.g. Abs Eosinophil" />
            </div>
            <div>
              <Label>Field Corrected</Label>
              <Select value={newField} onValueChange={setNewField}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="parameter_name">Parameter Name</SelectItem>
                  <SelectItem value="result_value">Result Value</SelectItem>
                  <SelectItem value="unit">Unit</SelectItem>
                  <SelectItem value="normal_range_low">Normal Range Low</SelectItem>
                  <SelectItem value="normal_range_high">Normal Range High</SelectItem>
                  <SelectItem value="normal_range_text">Normal Range Text</SelectItem>
                  <SelectItem value="flag">Flag</SelectItem>
                  <SelectItem value="test_name">Test Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Original Value (what AI extracted)</Label>
              <Input value={newOriginal} onChange={(e) => setNewOriginal(e.target.value)} placeholder="e.g. Abs Eosinophils" />
            </div>
            <div>
              <Label>Corrected Value</Label>
              <Input value={newCorrected} onChange={(e) => setNewCorrected(e.target.value)} placeholder="e.g. Abs Eosinophil" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!newParam || addMutation.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logged Corrections</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Original</TableHead>
                    <TableHead>Corrected</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corrections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.parameter_name}</TableCell>
                      <TableCell>{c.field_corrected}</TableCell>
                      <TableCell className="text-destructive">{c.original_value || "—"}</TableCell>
                      <TableCell className="text-green-600 dark:text-green-400">{c.corrected_value || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(c.created_at), "dd MMM yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExtractionCorrections;