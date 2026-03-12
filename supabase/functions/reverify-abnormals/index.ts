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

    const systemPrompt = `You are a medical report verification engine. You will receive:
1. Images of a pathology lab report PDF
2. A list of previously extracted test results with their values and normal ranges

YOUR TASK: Re-read the actual PDF images carefully and verify EVERY single test result value and normal range.

CRITICAL RULES:
- For EACH parameter in the list, find it in the PDF image and read the EXACT result value printed there.
- USE LAYOUT-AWARE READING: Elements at the same Y-coordinate belong to the same row. Sort by X-coordinate for column order.
- NUMERIC COLLISION PREVENTION: Many rows have multiple numbers (result + reference range numbers). The result_value is the number immediately after the test name, BEFORE the reference range column. Reference ranges contain two numbers separated by "-" or "to".
- For normal ranges, extract the COMPLETE text as shown in the PDF. Do NOT truncate or abbreviate. If the range says "Adult No Risk >60mg/dL Moderate Risk 40-60mg/dL High Risk <40 mg/dL", return the ENTIRE string.
- Pay special attention to decimal values - read each digit carefully (e.g., 9.6 vs 9.9, 7.05 vs 7.08).
- Pay special attention to large numbers - read all digits (e.g., 474000 vs 477000).
- If a value in the extracted list differs from what you see in the PDF, return the CORRECT value from the PDF.
- If you cannot confidently find a parameter in the PDF, keep the originally extracted value unchanged.
- Return ALL parameters, not just corrected ones.
- The order of returned results should match the input order.

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
              { type: "text", text: "Re-read the PDF images and verify every test result value and normal range. Return the corrected data for ALL parameters." },
              ...imageContents,
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_verified_results",
            description: "Return all verified test results after re-reading the PDF",
            parameters: {
              type: "object",
              properties: {
                verified_results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      parameter_name: { type: "string", description: "Exact parameter name" },
                      result_value: { type: "string", description: "The EXACT result value as printed in the PDF" },
                      unit: { type: "string", description: "Unit as shown in PDF" },
                      normal_range_text: { type: "string", description: "The COMPLETE normal range text as shown in PDF, do NOT truncate or abbreviate" },
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
