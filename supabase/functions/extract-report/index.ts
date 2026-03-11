import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, testParameters } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const paramList = (testParameters || [])
      .map((p: any) => `${p.parameter_name}|${p.unit || ''}|${p.normal_range_low ?? ''}|${p.normal_range_high ?? ''}|${p.department || ''}|${p.profile || ''}`)
      .join("\n");

    const systemPrompt = `You are an expert pathology report data extractor. Extract ALL data from the uploaded pathology report pages.

EXTRACTION RULES:
1. Extract patient demographics: name, age, gender, UMR ID (if present), referring doctor, collection date, report date
2. Extract ALL test results with: test/parameter name, result value, unit, reference/normal range
3. Detect pathologist name from signature area or footer
4. Clean numeric values: remove flags like H, L, *, etc. Keep the raw numeric value
5. Parse ranges: "12-15" → low=12, high=15. "<200" → low=0, high=200. ">40" → low=40, high=null
6. Identify department for each test (Biochemistry, Haematology, Immunology, Microbiology, etc.)
7. Identify if tests belong to a profile (e.g., Lipid Profile, Liver Function Test, Renal Function Test, CBC, Thyroid Profile)
8. For each result, determine if it's abnormal: H (high - result above normal_range_high), L (low - result below normal_range_low), or N (normal - within range)

CRITICAL - UMR ID RULES:
- UMR ID is a UNIQUE MEDICAL RECORD number, typically starting with "UMR" followed by digits (e.g., UMR0001234)
- Do NOT confuse "Reg.No", "Registration Number", "Invoice Number", "Bill Number", or "Lab Number" with UMR ID - these are different identifiers
- ONLY extract umr_id if you find a field explicitly labeled "UMR" or "UMR ID" or "Unique Medical Record"
- If no UMR ID is found, return umr_id as empty string ""

CRITICAL - ABNORMAL FLAG RULES:
- Compare each numeric result_value against normal_range_low and normal_range_high
- If result_value > normal_range_high → flag = "H"
- If result_value < normal_range_low → flag = "L"  
- Otherwise → flag = "N"
- Always set a flag for every test result

KNOWN TEST PARAMETERS IN OUR SYSTEM (try to match extracted tests to these):
${paramList || 'No parameters configured yet'}

MATCHING RULES:
- Use fuzzy matching for parameter names
- Common abbreviations: CBC=Complete Blood Count, LFT=Liver Function Test, KFT=Kidney/Renal Function Test, TFT=Thyroid Function Test
- Match extracted parameters to the closest known parameter name`;

    const imageContents = (pageImages || []).map((img: string) => ({
      type: "image_url",
      image_url: { url: img }
    }));

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
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all patient information and test results from this pathology report. Return structured data." },
              ...imageContents,
            ],
          },
        ],
        tools: [{
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
                    umr_id: { type: "string", description: "UMR/MRN/Patient ID number" },
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
                      profile_name: { type: "string", description: "Profile this test belongs to, if any" },
                      test_name: { type: "string" },
                      parameter_name: { type: "string" },
                      result_value: { type: "string" },
                      unit: { type: "string" },
                      normal_range_low: { type: "string" },
                      normal_range_high: { type: "string" },
                      normal_range_text: { type: "string", description: "Full range text as shown in report" },
                      flag: { type: "string", enum: ["H", "L", "N"] },
                      matched_parameter_id: { type: "string", description: "ID of matched parameter from our system" },
                    },
                    required: ["parameter_name", "result_value"],
                  },
                },
                pathologist_name: { type: "string" },
              },
              required: ["patient", "test_results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_report_data" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured data returned from AI");

    const extracted = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(extracted), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("extract-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
