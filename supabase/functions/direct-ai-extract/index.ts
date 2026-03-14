import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const clampConfidence = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
};

const normalizeFlag = (row: any) => {
  const result = String(row?.result_value ?? "").trim();
  const low = parseFloat(String(row?.normal_range_low ?? ""));
  const high = parseFloat(String(row?.normal_range_high ?? ""));
  const numericResult = parseFloat(result.replace(/[<>=,%\\s]/g, ""));

  if (!Number.isFinite(numericResult) || (!Number.isFinite(low) && !Number.isFinite(high))) {
    return row?.flag || "N";
  }

  if (Number.isFinite(high) && numericResult > high) return "H";
  if (Number.isFinite(low) && numericResult < low) return "L";
  return "N";
};

const buildSystemPrompt = (paramList: string, correctionsBlock: string) => `You are an advanced pathology report extraction engine.

RELIABILITY MODE (STRICT):
1) Extract ALL test results from the PDF report with high accuracy.
2) Extract row-by-row. Keep Test Name -> Result -> Unit -> Reference Range from the same row.
3) For each extracted result return source_page, confidence_score (0-100), extraction_basis.
4) If uncertain, keep confidence low (<80). Do not hallucinate.
5) If a field is missing, return empty string/null instead of guessing.

CRITICAL - EXTRACT ALL PARAMETERS INCLUDING QUALITATIVE/TEXT RESULTS:
- Extract EVERY parameter row from ALL sections including physical, chemical, microscopic examination.
- Text/qualitative results like "Absent", "Nil", "Negative", "Clear" are VALID result_value entries.
- For qualitative results, set flag to "N" (normal).

PATIENT DEMOGRAPHICS:
- Extract: name, age, gender, UMR ID (strictly UMR-labeled only), ref doctor, collection/report dates
- Also extract: Reg.No, Reg.Date, Sample Collection Date/Time, Accession Date, Authentication Date, Print Date, Location

UMR RULE:
- Only capture umr_id if explicitly labeled UMR/UMR ID/Unique Medical Record.

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
- Extract COMPLETE reference range text including ALL categories for advisory-style ranges.
- For normal_range_low/high, use the "normal/sufficient/no-risk" bounds.

ABNORMAL FLAG RULE:
- Compare numeric result with normal_range_low/high: > high => H, < low => L, else N.
- For qualitative results, set flag to "N".

KNOWN PARAMETERS:
${paramList || "No parameters configured yet"}

${correctionsBlock ? `LEARNED CORRECTIONS:\n${correctionsBlock}` : ""}

DEPARTMENT GROUPING RULE (CRITICAL):
- EVERY test result MUST have a "department" field assigned.
- Use the department column from KNOWN PARAMETERS to assign departments.
- Common department mappings: CBC/Haematology tests -> HAEMATOLOGY, LFT/Liver tests -> BIOCHEMISTRY, KFT/Kidney tests -> BIOCHEMISTRY, TFT/Thyroid -> BIOCHEMISTRY, Urine tests -> CLINICAL PATHOLOGY, Stool tests -> CLINICAL PATHOLOGY, Blood grouping -> SEROLOGY/IMMUNOLOGY.
- If a parameter matches a known parameter, use that parameter's department.
- If no match found, infer department from the section header in the PDF (e.g., "HAEMATOLOGY", "BIOCHEMISTRY", "CLINICAL PATHOLOGY", "MICROBIOLOGY", "SEROLOGY").
- Group results logically: all CBC parameters under same department, all LFT under same department, etc.

PROFILE MAPPING RULE (CRITICAL FOR DISAMBIGUATION):
- Use the "profile" column in KNOWN PARAMETERS to set profile_name for each extracted row.
- Section headers like "STOOL EXAMINATION", "URINE EXAMINATION" should map to the closest known profile name.

CLINICAL METADATA EXTRACTION (CRITICAL):
- For each test result or profile/section, extract these fields if visible on the PDF:
  1) sample_type: The specimen type (e.g., "EDTA Whole Blood", "Serum", "Urine", "Stool", "Citrated Blood")
  2) analyzer: The instrument/machine name used (e.g., "Sysmex XN-1000", "Beckman AU5800", "Mindray BC-6800")
  3) method: The testing methodology (e.g., "Automated Cell Counter", "Ion Selective Electrode", "Turbidimetry", "ELISA")
  4) interpretation: Any clinical interpretation, notes, or comments printed on the report for that test/profile section.
     - Extract the FULL interpretation text including all bullet points, categories, classifications.
     - Preserve the original formatting structure (line breaks, bullet points, table-like data).
     - For advisory ranges with categories (e.g., Vitamin D levels, HbA1c classifications), extract the COMPLETE category table/list.
- These fields are often printed as metadata rows above or below a test section, or in a footer area.
- If metadata applies to an entire profile/section (e.g., sample type for CBC), assign it to ALL parameters in that section.
- If not visible, leave the field as empty string.

NORMAL RANGE FORMATTING (CRITICAL):
- For simple numeric ranges, use normal_range_low and normal_range_high.
- For advisory/categorical ranges (e.g., Vitamin D, HbA1c, Lipid profiles), extract the COMPLETE text into normal_range_text.
- Preserve line breaks and categories in normal_range_text using "\\n" for each new line.
- Example format for advisory ranges:
  "Deficient: < 20 ng/mL\\nInsufficient: 20 - 30 ng/mL\\nSufficient: 30 - 100 ng/mL\\nToxic: > 100 ng/mL"

MATCHING:
- Fuzzy match abbreviations (CBC, LFT, KFT, TFT).
- Prefer closest known parameter name and return matched_parameter_id if known.`;

const toolSchema = {
  type: "function",
  function: {
    name: "extract_report_data",
    description: "Extract structured pathology report data",
    parameters: {
      type: "object",
      properties: {
        patient: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "string" },
            gender: { type: "string" },
            umr_id: { type: "string" },
            reg_no: { type: "string" },
            reg_date: { type: "string" },
            sample_collection_date: { type: "string" },
            accession_date: { type: "string" },
            authentication_date: { type: "string" },
            print_date: { type: "string" },
            location: { type: "string" },
            ref_doctor: { type: "string" },
            collection_date: { type: "string" },
            report_date: { type: "string" },
          },
          required: ["name"],
        },
        test_results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              department: { type: "string" },
              profile_name: { type: "string" },
              test_name: { type: "string" },
              parameter_name: { type: "string" },
              result_value: { type: "string" },
              unit: { type: "string" },
              normal_range_low: { type: "string" },
              normal_range_high: { type: "string" },
              normal_range_text: { type: "string" },
              flag: { type: "string", enum: ["H", "L", "N"] },
              matched_parameter_id: { type: "string" },
              approved_by: { type: "string" },
              source_page: { type: "number" },
              confidence_score: { type: "number" },
              extraction_basis: { type: "string" },
            },
            required: ["parameter_name", "result_value"],
          },
        },
        pathologist_names: { type: "array", items: { type: "string" } },
        pathologist_name: { type: "string" },
      },
      required: ["patient", "test_results"],
    },
  },
};

const parseAIResponse = (rawText: string): any => {
  let aiResult: any;
  try {
    aiResult = JSON.parse(rawText);
  } catch (_e) {
    const lastBrace = rawText.lastIndexOf("}");
    if (lastBrace > 0) {
      aiResult = JSON.parse(rawText.substring(0, lastBrace + 1));
    } else {
      throw new Error("AI returned invalid response");
    }
  }

  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("No structured data returned from AI");

  const fnArgs = toolCall.function.arguments || "{}";
  try {
    return JSON.parse(fnArgs);
  } catch (_e) {
    const lastBrace = fnArgs.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        return JSON.parse(fnArgs.substring(0, lastBrace + 1));
      } catch (_e2) {
        return JSON.parse(fnArgs.substring(0, lastBrace + 1) + "]}");
      }
    }
    throw new Error("No valid JSON in tool arguments");
  }
};

const callAI = async (
  LOVABLE_API_KEY: string,
  systemPrompt: string,
  userContent: any[],
  model = "google/gemini-2.5-flash"
): Promise<any> => {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [toolSchema],
      tool_choice: { type: "function", function: { name: "extract_report_data" } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI gateway error:", response.status, errText);
    throw new Error(`AI error: ${response.status}`);
  }

  return parseAIResponse(await response.text());
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) throw new Error("pdfBase64 is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch test parameters
    const { data: params } = await supabase
      .from("report_test_parameters")
      .select("id, parameter_name, unit, normal_range_low, normal_range_high, department_id, profile_id, report_departments(department_name), report_profiles(profile_name)");

    const testParameters = (params || []).map((p: any) => ({
      id: p.id,
      parameter_name: p.parameter_name,
      unit: p.unit,
      normal_range_low: p.normal_range_low,
      normal_range_high: p.normal_range_high,
      department: p.report_departments?.department_name || "",
      profile: p.report_profiles?.profile_name || "",
    }));

    // Fetch corrections
    let correctionsBlock = "";
    try {
      const { data: corrections } = await supabase
        .from("extraction_corrections")
        .select("parameter_name, field_corrected, original_value, corrected_value")
        .order("created_at", { ascending: false })
        .limit(100);

      if (corrections && corrections.length > 0) {
        const seen = new Set<string>();
        const unique: typeof corrections = [];
        for (const c of corrections) {
          const key = `${c.parameter_name}|${c.field_corrected}`;
          if (!seen.has(key)) { seen.add(key); unique.push(c); }
        }
        correctionsBlock = unique.slice(0, 50).map(
          (c: any) => `- Parameter "${c.parameter_name}": ${c.field_corrected} should be "${c.corrected_value}" not "${c.original_value}"`
        ).join("\n");
      }
    } catch (e) {
      console.error("Failed to fetch corrections (non-fatal):", e);
    }

    const paramList = testParameters
      .map((p: any) => `${p.parameter_name}|${p.unit || ""}|${p.normal_range_low ?? ""}|${p.normal_range_high ?? ""}|${p.department || ""}|${p.profile || ""}`)
      .join("\n");

    const systemPrompt = buildSystemPrompt(paramList, correctionsBlock);

    // ═══════ FIRST PASS ═══════
    console.log("Direct AI: First pass extraction...");
    const userContent: any[] = [
      { type: "text", text: "Extract all patient fields and test rows from this pathology report PDF with maximum accuracy. Return structured output only." },
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
    ];

    const firstPass = await callAI(LOVABLE_API_KEY, systemPrompt, userContent);

    const firstResults = Array.isArray(firstPass?.test_results)
      ? firstPass.test_results.map((row: any) => ({
          ...row,
          source_page: Number(row?.source_page) || 1,
          confidence_score: clampConfidence(row?.confidence_score),
          extraction_basis: String(row?.extraction_basis || "hybrid"),
          flag: normalizeFlag(row),
        }))
      : [];

    console.log(`First pass: ${firstResults.length} results extracted`);

    // ═══════ SECOND PASS: Re-verify low-confidence rows ═══════
    const LOW_CONFIDENCE_THRESHOLD = 85;
    const lowConfRows = firstResults.filter((r: any) => r.confidence_score < LOW_CONFIDENCE_THRESHOLD);

    let finalResults = firstResults;

    if (lowConfRows.length > 0) {
      console.log(`Second pass: Re-verifying ${lowConfRows.length} low-confidence rows...`);

      const lowConfList = lowConfRows.map((r: any, i: number) =>
        `${i + 1}. Parameter: "${r.parameter_name}", Current Value: "${r.result_value}", Unit: "${r.unit || ""}", Range: "${r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`}", Flag: "${r.flag}", Page: ${r.source_page}, Confidence: ${r.confidence_score}`
      ).join("\n");

      const secondPassPrompt = `You are a VERIFICATION engine for pathology report extraction. You previously extracted data but some rows had low confidence.

RE-VERIFY these specific rows by carefully re-reading the PDF. For each row, confirm or correct the values.

LOW CONFIDENCE ROWS TO VERIFY:
${lowConfList}

RULES:
1) Re-read the exact location on the PDF for each row
2) Confirm or correct: parameter_name, result_value, unit, normal_range_low, normal_range_high, normal_range_text, flag, approved_by
3) Set confidence_score to your new confidence (should be higher after careful re-reading)
4) Keep source_page accurate
5) Do NOT skip any row - return ALL rows listed above with corrections
6) Also check if any rows were MISSED in the first pass and add them

Return the COMPLETE set of test results (both verified low-confidence rows AND any newly found rows).
Include the original patient data as well.`;

      const secondPassContent: any[] = [
        { type: "text", text: secondPassPrompt },
        { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
      ];

      try {
        const secondPass = await callAI(LOVABLE_API_KEY, buildSystemPrompt(paramList, correctionsBlock), secondPassContent, "google/gemini-2.5-pro");

        const verifiedResults = Array.isArray(secondPass?.test_results)
          ? secondPass.test_results.map((row: any) => ({
              ...row,
              source_page: Number(row?.source_page) || 1,
              confidence_score: clampConfidence(row?.confidence_score),
              extraction_basis: "second_pass_verified",
              flag: normalizeFlag(row),
            }))
          : [];

        if (verifiedResults.length > 0) {
          // Merge: replace low-confidence rows with verified versions, keep high-confidence ones
          const highConfResults = firstResults.filter((r: any) => r.confidence_score >= LOW_CONFIDENCE_THRESHOLD);
          
          // Build map from verified results keyed by parameter_name
          const verifiedMap = new Map<string, any>();
          verifiedResults.forEach((r: any) => {
            const key = `${(r.parameter_name || "").toLowerCase().trim()}::${(r.test_name || "").toLowerCase().trim()}`;
            verifiedMap.set(key, r);
          });

          // Replace low-conf rows with verified versions
          const mergedLowConf = lowConfRows.map((r: any) => {
            const key = `${(r.parameter_name || "").toLowerCase().trim()}::${(r.test_name || "").toLowerCase().trim()}`;
            return verifiedMap.get(key) || r;
          });

          // Check for newly discovered rows
          const existingKeys = new Set<string>();
          [...highConfResults, ...mergedLowConf].forEach((r: any) => {
            existingKeys.add(`${(r.parameter_name || "").toLowerCase().trim()}::${(r.test_name || "").toLowerCase().trim()}`);
          });

          const newRows = verifiedResults.filter((r: any) => {
            const key = `${(r.parameter_name || "").toLowerCase().trim()}::${(r.test_name || "").toLowerCase().trim()}`;
            return !existingKeys.has(key);
          });

          finalResults = [...highConfResults, ...mergedLowConf, ...newRows];
          console.log(`Second pass complete: ${finalResults.length} total results (${newRows.length} new rows found)`);
        }
      } catch (e) {
        console.error("Second pass failed (using first pass results):", e);
      }
    }

    // Normalize patient data
    const patient = { ...(firstPass?.patient || {}) };
    if (!patient.collection_date && patient.sample_collection_date) {
      patient.collection_date = patient.sample_collection_date;
    }
    if (!patient.report_date && patient.authentication_date) {
      patient.report_date = patient.authentication_date;
    }

    const pathologistNames = Array.isArray(firstPass?.pathologist_names) ? firstPass.pathologist_names : [];
    const pathologistName = firstPass?.pathologist_name || "";
    const uniquePathologists = [...new Set(pathologistNames.filter(Boolean))];

    // Fill approved_by fallback
    const finalResultsWithApproval = pathologistName
      ? finalResults.map((r: any) => ({ ...r, approved_by: r.approved_by || pathologistName }))
      : finalResults;

    return new Response(JSON.stringify({
      patient,
      test_results: finalResultsWithApproval,
      pathologist_name: uniquePathologists.join(", ") || pathologistName,
      pathologist_names: uniquePathologists,
      first_pass_count: firstResults.length,
      low_confidence_count: lowConfRows.length,
      final_count: finalResultsWithApproval.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("direct-ai-extract error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
