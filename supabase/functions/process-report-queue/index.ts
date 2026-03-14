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
  const numericResult = parseFloat(result.replace(/[<>=,%\s]/g, ""));

  if (!Number.isFinite(numericResult) || (!Number.isFinite(low) && !Number.isFinite(high))) {
    return row?.flag || "N";
  }

  if (Number.isFinite(high) && numericResult > high) return "H";
  if (Number.isFinite(low) && numericResult < low) return "L";
  return "N";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Reset reports stuck in "Processing" for > 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase
      .from("uploaded_reports")
      .update({ status: "Pending" })
      .eq("status", "Processing")
      .lt("updated_at", tenMinAgo);

    // Pick oldest Pending report
    const { data: pending, error: fetchErr } = await supabase
      .from("uploaded_reports")
      .select("*")
      .eq("status", "Pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (!pending) {
      return new Response(JSON.stringify({ message: "No pending reports", processed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing report ${pending.id}: ${pending.file_name}`);

    // Lock it by setting to Processing
    await supabase
      .from("uploaded_reports")
      .update({ status: "Processing", updated_at: new Date().toISOString() })
      .eq("id", pending.id);

    // Download PDF from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("report-uploads")
      .download(pending.file_path);

    if (dlErr || !fileData) {
      throw new Error(`Failed to download PDF: ${dlErr?.message || "no data"}`);
    }

    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfBase64 = base64Encode(pdfBytes);
    console.log(`PDF size: ${pdfBytes.length} bytes, base64 length: ${pdfBase64.length}`);

    // Fetch test parameters for matching
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
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(c);
          }
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

    // Build AI prompt (same as extract-report)
    const systemPrompt = `You are an advanced pathology report extraction engine.

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

PATHOLOGIST / APPROVED BY RULE:
- Each page may have a DIFFERENT doctor approving tests.
- For EACH test result, set approved_by to the doctor on the SAME PAGE.
- Return full doctor name including title.

REFERENCE RANGE RULE:
- Extract COMPLETE reference range text including ALL categories.
- For normal_range_low/high, use the "normal/sufficient/no-risk" bounds.

ABNORMAL FLAG RULE:
- Compare numeric result with normal_range_low/high: > high => H, < low => L, else N.
- For qualitative results, set flag to "N".

KNOWN PARAMETERS:
${paramList || "No parameters configured yet"}

${correctionsBlock ? `LEARNED CORRECTIONS:\n${correctionsBlock}` : ""}

PROFILE MAPPING RULE (CRITICAL FOR DISAMBIGUATION):
- The KNOWN PARAMETERS list includes a "profile" column. Use it to set profile_name for each extracted row.
- Section headers like "STOOL EXAMINATION", "URINE EXAMINATION" should map to the closest known profile name from the list.
- This is critical for disambiguating parameters with identical names across different test sections (e.g., "Colour" in Stool vs Urine).
- If a section header says "STOOL EXAMINATION" and the known profiles include "Stool Routine Analysis", set profile_name to "Stool Routine Analysis".

MATCHING:
- Fuzzy match abbreviations (CBC, LFT, KFT, TFT).
- Prefer closest known parameter name and return matched_parameter_id if known.`;

    // Send PDF to AI gateway
    const userContent: any[] = [
      {
        type: "text",
        text: "Extract all patient fields and test rows from this pathology report PDF. Return structured output only.",
      },
      {
        type: "image_url",
        image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
      },
    ];

    console.log("Sending to AI gateway...");
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [
          {
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
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_report_data" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429 || response.status === 402) {
        // Revert to Pending so it can be retried
        await supabase.from("uploaded_reports").update({ status: "Pending" }).eq("id", pending.id);
        return new Response(JSON.stringify({ error: `AI error: ${response.status}`, processed: false }), {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const rawText = await response.text();
    let aiResult: any;
    try {
      aiResult = JSON.parse(rawText);
    } catch (_e) {
      console.error("Failed to parse AI response, attempting recovery");
      const lastBrace = rawText.lastIndexOf("}");
      if (lastBrace > 0) {
        try {
          aiResult = JSON.parse(rawText.substring(0, lastBrace + 1));
        } catch (_e2) {
          throw new Error("AI returned truncated response that could not be repaired");
        }
      } else {
        throw new Error("AI returned invalid response");
      }
    }

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured data returned from AI");

    let extracted: any;
    const fnArgs = toolCall.function.arguments || "{}";
    try {
      extracted = JSON.parse(fnArgs);
    } catch (_e) {
      const lastBrace = fnArgs.lastIndexOf("}");
      if (lastBrace > 0) {
        try {
          extracted = JSON.parse(fnArgs.substring(0, lastBrace + 1));
        } catch (_e2) {
          try {
            extracted = JSON.parse(fnArgs.substring(0, lastBrace + 1) + "]}");
          } catch (_e3) {
            throw new Error("Tool arguments truncated beyond repair");
          }
        }
      } else {
        throw new Error("No valid JSON in tool arguments");
      }
    }

    console.log(`Extracted ${extracted?.test_results?.length || 0} test results`);

    // Normalize results
    const testResults = Array.isArray(extracted?.test_results)
      ? extracted.test_results.map((row: any) => ({
          ...row,
          source_page: Number(row?.source_page) || 1,
          confidence_score: clampConfidence(row?.confidence_score),
          extraction_basis: String(row?.extraction_basis || "hybrid"),
          flag: normalizeFlag(row),
        }))
      : [];

    // Deduplicate by parameter+scope (normalize punctuation/spacing variants)
    const normalizeKey = (v: unknown) =>
      String(v ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const getScope = (r: any) =>
      normalizeKey(r.profile_name) || normalizeKey(r.test_name) || normalizeKey(r.parameter_name) || "unknown-scope";

    const getKey = (r: any) => `${normalizeKey(r.parameter_name) || "unknown-parameter"}::${getScope(r)}`;

    const deduped = new Map<string, any>();
    testResults.forEach((row: any) => {
      const key = getKey(row);
      const existing = deduped.get(key);
      if (!existing || Number(row.confidence_score) >= Number(existing.confidence_score)) {
        deduped.set(key, row);
      }
    });
    const finalResults = Array.from(deduped.values());

    const patient = { ...(extracted?.patient || {}) };
    if (!patient.collection_date && patient.sample_collection_date) {
      patient.collection_date = patient.sample_collection_date;
    }
    if (!patient.report_date && patient.authentication_date) {
      patient.report_date = patient.authentication_date;
    }

    const pathologistName = extracted?.pathologist_name || "";
    const pathologistNames = Array.isArray(extracted?.pathologist_names) ? extracted.pathologist_names : [];
    const uniquePathologists = [...new Set(pathologistNames.filter(Boolean))];

    // Fill approved_by fallback
    const finalResultsWithApproval = pathologistName
      ? finalResults.map((r: any) => ({ ...r, approved_by: r.approved_by || pathologistName }))
      : finalResults;

    // Handle duplicate reg_no merging
    const extractedRegNo = patient?.reg_no || "";
    let targetReportId = pending.id;
    let finalTestResultsToSave = finalResultsWithApproval;

    if (extractedRegNo) {
      const { data: existingReports } = await supabase
        .from("uploaded_reports")
        .select("id")
        .eq("reg_no", extractedRegNo)
        .neq("id", pending.id)
        .limit(1);

      if (existingReports && existingReports.length > 0) {
        const existingReportId = existingReports[0].id;

        const { data: existingExtracted } = await supabase
          .from("extracted_report_data")
          .select("test_results")
          .eq("report_id", existingReportId)
          .limit(1);

        if (existingExtracted && existingExtracted.length > 0) {
          const existingResults = (existingExtracted[0].test_results as any[]) || [];
          const mergedMap = new Map<string, any>();

          existingResults.forEach((r: any) => {
            const { _merge_status, ...clean } = r;
            mergedMap.set(getKey(r), { ...clean, _merge_status: "existing" });
          });

          finalResultsWithApproval.forEach((r: any) => {
            const key = getKey(r);
            const old = mergedMap.get(key);
            if (!old) {
              mergedMap.set(key, { ...r, _merge_status: "new" });
            } else {
              const changed = String(r.result_value ?? "") !== String(old.result_value ?? "");
              mergedMap.set(key, { ...r, _merge_status: changed ? "updated" : "existing" });
            }
          });

          finalTestResultsToSave = Array.from(mergedMap.values());
        }

        targetReportId = existingReportId;

        // Clean up old data for the existing report
        await supabase.from("generated_reports").delete().eq("report_id", existingReportId);
        await supabase.from("raw_report_data").delete().eq("report_id", existingReportId);
        await supabase.from("test_result_history").delete().eq("report_id", existingReportId);
        await supabase.from("extracted_report_data").delete().eq("report_id", existingReportId);

        // Delete the temp report row
        await supabase.from("uploaded_reports").delete().eq("id", pending.id);

        console.log(`Merged into existing report ${existingReportId} for reg_no ${extractedRegNo}`);
      }
    }

    // Save extracted data
    const { error: saveError } = await supabase.from("extracted_report_data").insert({
      report_id: targetReportId,
      patient_name: patient?.name || "",
      age: patient?.age || "",
      gender: patient?.gender || "",
      umr_id: patient?.umr_id || "",
      ref_doctor: patient?.ref_doctor || "",
      collection_date: patient?.collection_date || "",
      report_date: patient?.report_date || "",
      reg_no: patient?.reg_no || "",
      reg_date: patient?.reg_date || "",
      sample_collection_date: patient?.sample_collection_date || "",
      accession_date: patient?.accession_date || "",
      authentication_date: patient?.authentication_date || "",
      print_date: patient?.print_date || "",
      location: patient?.location || "",
      test_results: finalTestResultsToSave || [],
      pathologist_name: uniquePathologists.join(", ") || pathologistName,
    });
    if (saveError) throw saveError;

    // Save raw data
    await supabase.from("raw_report_data").insert({
      report_id: targetReportId,
      umr_id: patient?.umr_id || "",
      raw_json: { patient, test_results: finalTestResultsToSave, pathologist_name: pathologistName },
    });

    // Update report status
    await supabase
      .from("uploaded_reports")
      .update({
        status: "Awaiting Review",
        umr_id: patient?.umr_id || "",
        patient_name: patient?.name || "",
        reg_no: patient?.reg_no || "",
        reg_date: patient?.reg_date || "",
      })
      .eq("id", targetReportId);

    console.log(`Report ${targetReportId} processed successfully`);

    // Check if there are more pending reports
    const { count } = await supabase
      .from("uploaded_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "Pending");

    return new Response(JSON.stringify({
      processed: true,
      reportId: targetReportId,
      remainingPending: count || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Queue processing error:", e);

    // Try to revert status
    try {
      const body = await req.clone().json().catch(() => ({}));
      // We stored pending.id before, but can't access it here if error was early
      // The stuck-processing reset at the top will handle it
    } catch (_) {}

    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
      processed: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
