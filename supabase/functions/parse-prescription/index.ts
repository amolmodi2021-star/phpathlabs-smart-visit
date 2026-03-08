import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, availableTests } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const testListStr = availableTests.map((t: any) => `- "${t.test_name}" (ID: ${t.id})`).join("\n");

    const systemPrompt = `You are a medical prescription reader. Extract test/investigation names from prescription images. Match them to the available test list provided. Return results as a JSON tool call.

Available tests in our system:
${testListStr}

Instructions:
1. Read the prescription image carefully
2. Identify all medical tests/investigations recommended
3. For each test found, try to match it to the closest test from our available list
4. Consider common abbreviations and alternate names (e.g., "CBC" = "Complete Blood Count", "LFT" = "Liver Function Test", "KFT" = "Kidney Function Test", "TFT" = "Thyroid Function Test", "HbA1c" = "Glycosylated Hemoglobin")
5. If a test from prescription doesn't match any available test, mark it as unmatched
6. Also try to extract patient name if visible on the prescription`;

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
              { type: "text", text: "Read this prescription and extract all recommended tests. Match them to our available test list." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "prescription_results",
              description: "Return extracted prescription data with matched and unmatched tests",
              parameters: {
                type: "object",
                properties: {
                  patient_name: { type: "string", description: "Patient name if found on prescription, empty string if not found" },
                  matched_tests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        prescription_text: { type: "string", description: "Test name as written on prescription" },
                        matched_test_id: { type: "string", description: "ID of matched test from available list" },
                        matched_test_name: { type: "string", description: "Name of matched test from available list" },
                        confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence of the match" },
                      },
                      required: ["prescription_text", "matched_test_id", "matched_test_name", "confidence"],
                    },
                  },
                  unmatched_tests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        prescription_text: { type: "string", description: "Test name as written on prescription that could not be matched" },
                      },
                      required: ["prescription_text"],
                    },
                  },
                },
                required: ["patient_name", "matched_tests", "unmatched_tests"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "prescription_results" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI error:", response.status, text);
      throw new Error("AI processing failed");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No results from AI");

    const results = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-prescription error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
