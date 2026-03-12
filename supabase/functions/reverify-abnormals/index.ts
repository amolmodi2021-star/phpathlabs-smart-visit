import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, testResults } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!pageImages?.length || !testResults?.length) {
      throw new Error("Both pageImages and testResults are required");
    }

    // Build a numbered list of currently extracted results for AI to verify
    const resultsList = testResults.map((r: any, i: number) =>
      `${i + 1}. ${r.parameter_name} | Result: ${r.result_value} | Unit: ${r.unit || ''} | Range: ${r.normal_range_text || `${r.normal_range_low || ''}-${r.normal_range_high || ''}`}`
    ).join("\n");

    const systemPrompt = `You are a medical report OCR verification engine. Your job is to RE-READ the original PDF images and CORRECT any extraction errors.

INPUT:
1. Images of a pathology lab report PDF
2. A list of previously extracted test results

YOUR TASK: For EVERY parameter in the list, locate it in the PDF image, read the EXACT printed value character-by-character, and return the correct data.

CRITICAL OCR RULES FOR ACCURACY:

DIGIT-BY-DIGIT READING:
- Read each digit individually. Do NOT guess or approximate.
- Pay extreme attention to similar-looking digits: 0 vs 6, 3 vs 8, 5 vs 6, 1 vs 7, 9 vs 0.
- For decimals: carefully distinguish 9.6 vs 9.9, 7.05 vs 7.08, 4.10 vs 4.73, 2.95 vs 2.35.
- For large numbers: read ALL digits carefully. 474000 is NOT 477000. Count each digit.

LAYOUT-AWARE ROW MATCHING:
- Use spatial layout to match values to the correct parameter row.
- Elements at the same Y-coordinate belong to the same row.
- The result_value is the number immediately after the test name, BEFORE the reference range column.
- Do NOT confuse numbers from adjacent rows (e.g., Lymphocytes 39 vs Monocytes 05).

REFERENCE RANGE - COMPLETE TEXT EXTRACTION:
- Extract the COMPLETE reference range text exactly as printed in the PDF.
- Do NOT truncate, abbreviate, or summarize.
- Example: If PDF shows "Adult No Risk >60mg/dL Moderate Risk 40-60mg/dL High Risk <40 mg/dL", return THAT ENTIRE STRING.
- Multi-line ranges: concatenate all lines with spaces.
- Risk-stratified ranges, age-based ranges, gender-based ranges: capture ALL of it.

PARAMETER NAME VERIFICATION:
- Verify each parameter name matches what is printed in the PDF.
- Correct any misspellings or OCR artifacts in the parameter name.

UNIT VERIFICATION:
- Read the unit exactly as printed (e.g., mg/dL, g/dL, thou/cumm, million/cumm, fL, pg, %, IU/L).

RETURN ALL PARAMETERS - not just corrected ones. Maintain the input order.
If you cannot confidently find a parameter in the PDF, keep the originally extracted values.

PREVIOUSLY EXTRACTED RESULTS TO VERIFY:
${resultsList}`;

    const imageContents = pageImages.map((img: string) => ({
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
              { type: "text", text: "Re-read every value from the PDF images character-by-character. Verify and correct ALL test result values, units, and complete normal ranges. Return structured data for ALL parameters." },
              ...imageContents,
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_verified_results",
            description: "Return all verified test results after re-reading the PDF character by character",
            parameters: {
              type: "object",
              properties: {
                verified_results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      parameter_name: { type: "string", description: "Exact parameter name as printed in the PDF" },
                      result_value: { type: "string", description: "The EXACT result value read digit-by-digit from the PDF" },
                      unit: { type: "string", description: "Unit exactly as printed in PDF" },
                      normal_range_text: { type: "string", description: "The COMPLETE and UNTRUNCATED normal range text as shown in PDF. Include ALL risk categories, age/gender variants, and multi-line text. NEVER abbreviate." },
                      normal_range_low: { type: "string", description: "Lower bound of normal range if parseable" },
                      normal_range_high: { type: "string", description: "Upper bound of normal range if parseable" },
                    },
                    required: ["parameter_name", "result_value"],
                  },
                },
              },
              required: ["verified_results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_verified_results" } },
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

    const parsed = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("reverify-abnormals error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
