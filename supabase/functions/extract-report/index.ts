import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const clampConfidence = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
};

const buildPageTextContext = (pageTexts: string[] = [], pageNumbers: number[] = []) => {
  if (!Array.isArray(pageTexts) || pageTexts.length === 0) return "";

  return pageTexts
    .map((text, idx) => {
      const pageNo = Number(pageNumbers?.[idx] ?? idx + 1);
      const cleaned = String(text ?? "").trim().slice(0, 22000);
      if (!cleaned) return "";
      return `PAGE ${pageNo} TEXT LAYER:\n${cleaned}`;
    })
    .filter(Boolean)
    .join("\n\n");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, pageTexts, pageNumbers, testParameters } = await req.json();

    if (!Array.isArray(pageImages) || pageImages.length === 0) {
      throw new Error("pageImages are required");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const paramList = (testParameters || [])
      .map(
        (p: any) =>
          `${p.parameter_name}|${p.unit || ""}|${p.normal_range_low ?? ""}|${p.normal_range_high ?? ""}|${p.department || ""}|${p.profile || ""}`,
      )
      .join("\n");

    const pageTextContext = buildPageTextContext(pageTexts || [], pageNumbers || []);

    const systemPrompt = `You are an advanced pathology report extraction engine.

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

PATHOLOGIST RULE:
- Capture all pathologist/doctor names found near signatures/approval labels.
- Fill approved_by per test if inferable by section/page proximity.

ABNORMAL FLAG RULE:
- Compare numeric result with normal_range_low/high:
  > high => H, < low => L, else N.
- For qualitative results (Absent, Nil, Negative, etc.), set flag to "N".

KNOWN PARAMETERS:
${paramList || "No parameters configured yet"}

MATCHING:
- Fuzzy match abbreviations (CBC, LFT, KFT, TFT).
- Prefer closest known parameter name and return matched_parameter_id if known.`;

    const imageContents = (pageImages || []).map((img: string) => ({
      type: "image_url",
      image_url: { url: img },
    }));

    const userContent: any[] = [
      {
        type: "text",
        text:
          "Extract all patient fields and test rows with high reliability. Use row alignment strictly and return structured output only.",
      },
    ];

    if (pageTextContext) {
      userContent.push({
        type: "text",
        text: `TEXT LAYER CONTEXT (PRIMARY):\n${pageTextContext}`,
      });
    }

    userContent.push(...imageContents);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: userContent,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_report_data",
              description: "Extract structured pathology report data with row-level confidence and source page",
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
                        source_page: { type: "number", description: "Page number where this row was extracted from" },
                        confidence_score: { type: "number", description: "0-100 confidence score for this row" },
                        extraction_basis: { type: "string", description: "text_layer, vision, or hybrid" },
                      },
                      required: ["parameter_name", "result_value"],
                    },
                  },
                  pathologist_names: {
                    type: "array",
                    items: { type: "string" },
                  },
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
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured data returned from AI");

    const extracted = JSON.parse(toolCall.function.arguments || "{}");
    const fallbackPage = Number(pageNumbers?.[0] ?? 1) || 1;

    const normalizedResults = Array.isArray(extracted?.test_results)
      ? extracted.test_results.map((row: any) => ({
          ...row,
          source_page: Number(row?.source_page) || fallbackPage,
          confidence_score: clampConfidence(row?.confidence_score),
          extraction_basis: String(row?.extraction_basis || (pageTextContext ? "hybrid" : "vision")),
        }))
      : [];

    const patient = { ...(extracted?.patient || {}) };
    if (!patient.collection_date && patient.sample_collection_date) {
      patient.collection_date = patient.sample_collection_date;
    }
    if (!patient.report_date && patient.authentication_date) {
      patient.report_date = patient.authentication_date;
    }

    const normalized = {
      ...extracted,
      patient,
      test_results: normalizedResults,
    };

    return new Response(JSON.stringify(normalized), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
