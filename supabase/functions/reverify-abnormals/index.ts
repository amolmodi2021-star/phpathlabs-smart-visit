import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 5; // Process 5 parameters at a time for focused row-by-row reading

async function verifyChunk(
  pageImages: string[],
  chunk: any[],
  LOVABLE_API_KEY: string
): Promise<any[]> {
  const resultsList = chunk
    .map(
      (r: any, i: number) =>
        `${i + 1}. "${r.parameter_name}" | Extracted Result: "${r.result_value}" | Unit: "${r.unit || ""}" | Extracted Range: "${r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`}"`
    )
    .join("\n");

  const systemPrompt = `You are a medical report OCR verification engine performing ROW-BY-ROW re-reading.

You will receive:
1. Images of a pathology lab report PDF
2. A SHORT list of ${chunk.length} previously extracted test results to verify

YOUR TASK: For EACH of the ${chunk.length} parameters below, perform these steps IN ORDER:

STEP 1 - LOCATE THE ROW:
- Scan the PDF image to find the EXACT row containing this parameter name.
- Use spatial/positional awareness: the parameter name, result value, unit, and reference range must all be at the SAME vertical position (same Y-coordinate / same row).
- If the parameter appears in a table, identify which column contains what.

STEP 2 - READ THE RESULT VALUE CHARACTER BY CHARACTER:
- Once you've located the correct row, read the result value ONE DIGIT AT A TIME.
- Pay extreme attention to visually similar characters:
  * 0 vs 6 vs 9 (the curves differ)
  * 3 vs 8 (count the enclosed areas)
  * 5 vs 6 (check the top)
  * 1 vs 7 (check for serif/crossbar)
  * . vs , (decimal point position)
- For multi-digit numbers: read left to right, confirm EACH digit individually.
  Example: For "474000" - read "4", then "7", then "4", then "0", then "0", then "0".
- The result value is the number in the RESULT COLUMN, NOT in the reference range column.
- NEVER confuse a number from an adjacent row with this row's value.

STEP 3 - READ THE UNIT:
- Read the unit text from the SAME row, typically right of the result value.
- Common units: mg/dL, g/dL, IU/L, U/L, %, mmol/L, thou/cumm, million/cumm, fL, pg, g%, sec

STEP 4 - READ THE COMPLETE REFERENCE RANGE:
- Read the ENTIRE reference range text from the SAME row.
- Multi-line ranges: if the range spans multiple lines, concatenate ALL lines.
- Risk-stratified ranges (e.g., HDL Cholesterol): capture EVERY category.
  Example: "Adult No Risk >60mg/dL Moderate Risk 40-60mg/dL High Risk <40 mg/dL" - return ALL of this.
- Age/gender-based ranges: capture ALL variants shown.
- NEVER truncate or abbreviate. Return the COMPLETE text as printed.
- Parse numeric bounds where possible (low/high).

STEP 5 - VERIFY PARAMETER NAME:
- Confirm the parameter name matches what is printed. Correct any OCR artifacts.

PARAMETERS TO VERIFY (${chunk.length} total):
${resultsList}

IMPORTANT: Return ALL ${chunk.length} parameters. If you cannot confidently locate a parameter, return the originally extracted values unchanged.`;

  const imageContents = pageImages.map((img: string) => ({
    type: "image_url",
    image_url: { url: img },
  }));

  const response = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
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
              {
                type: "text",
                text: `Focus on these ${chunk.length} parameters ONLY. For each one: locate its exact row in the PDF, read the result value digit-by-digit, read the complete reference range text, and return corrected data.`,
              },
              ...imageContents,
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_verified_results",
              description:
                "Return verified test results after row-by-row re-reading from PDF",
              parameters: {
                type: "object",
                properties: {
                  verified_results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        parameter_name: {
                          type: "string",
                          description:
                            "Exact parameter name as printed in the PDF",
                        },
                        result_value: {
                          type: "string",
                          description:
                            "The EXACT result value read digit-by-digit from the PDF row",
                        },
                        unit: {
                          type: "string",
                          description: "Unit exactly as printed in PDF",
                        },
                        normal_range_text: {
                          type: "string",
                          description:
                            "The COMPLETE and UNTRUNCATED normal range text as shown in PDF. Include ALL risk categories, age/gender variants, and multi-line text. NEVER abbreviate.",
                        },
                        normal_range_low: {
                          type: "string",
                          description:
                            "Lower bound of normal range if parseable",
                        },
                        normal_range_high: {
                          type: "string",
                          description:
                            "Upper bound of normal range if parseable",
                        },
                      },
                      required: ["parameter_name", "result_value"],
                    },
                  },
                },
                required: ["verified_results"],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "return_verified_results" },
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI gateway error:", response.status, errText);
    if (response.status === 429 || response.status === 402) {
      throw { status: response.status, message: errText };
    }
    throw new Error(`AI error: ${response.status}`);
  }

  const aiResult = await response.json();
  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return [];

  const parsed = JSON.parse(toolCall.function.arguments);
  return parsed.verified_results || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, testResults } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!pageImages?.length || !testResults?.length) {
      throw new Error("Both pageImages and testResults are required");
    }

    // Process parameters in small chunks for focused row-by-row OCR
    const allVerified: any[] = [];
    for (let i = 0; i < testResults.length; i += CHUNK_SIZE) {
      const chunk = testResults.slice(i, i + CHUNK_SIZE);
      console.log(
        `Verifying chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(testResults.length / CHUNK_SIZE)}: ${chunk.map((c: any) => c.parameter_name).join(", ")}`
      );

      try {
        const results = await verifyChunk(pageImages, chunk, LOVABLE_API_KEY);
        allVerified.push(...results);
      } catch (e: any) {
        if (e.status === 429) {
          // Rate limited - wait and retry once
          console.log("Rate limited, waiting 3s before retry...");
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const results = await verifyChunk(pageImages, chunk, LOVABLE_API_KEY);
            allVerified.push(...results);
          } catch {
            console.error(`Chunk failed after retry, skipping: ${chunk.map((c: any) => c.parameter_name).join(", ")}`);
          }
        } else if (e.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Please add credits.", verified_results: allVerified }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          console.error(`Chunk failed: ${e.message || e}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ verified_results: allVerified }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("reverify-abnormals error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
