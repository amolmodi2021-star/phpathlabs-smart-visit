import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileUrls, tests } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build test list string for AI context
    const testListStr = tests.map((t: any) => `ID: ${t.id} | Name: ${t.test_name}`).join("\n");

    // Build content array with images
    const content: any[] = [
      {
        type: "text",
        text: `You are a medical prescription reader. Analyze the uploaded prescription image(s) and extract:
1. Patient name (if visible)
2. Phone/WhatsApp number (if visible)
3. All medical tests/investigations prescribed

Then match the prescribed tests against this available test list:
${testListStr}

For each prescribed test, find the best match from the list above. Mark confidence as "high" if you're sure, "low" if uncertain.
List any tests you cannot match as unrecognized.

Call the extract_prescription_data function with your findings.`,
      },
    ];

    // Add each image URL
    for (const url of fileUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content }],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_prescription_data",
              description: "Extract structured data from a prescription",
              parameters: {
                type: "object",
                properties: {
                  patient_name: { type: "string", description: "Patient name if found, empty string if not" },
                  whatsapp_number: { type: "string", description: "Phone/WhatsApp number if found, empty string if not" },
                  matched_tests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        test_id: { type: "string" },
                        test_name: { type: "string" },
                        confidence: { type: "string", enum: ["high", "low"] },
                      },
                      required: ["test_id", "test_name", "confidence"],
                    },
                  },
                  unrecognized_tests: {
                    type: "array",
                    items: { type: "string" },
                    description: "Test names from prescription that could not be matched",
                  },
                },
                required: ["patient_name", "whatsapp_number", "matched_tests", "unrecognized_tests"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_prescription_data" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return structured data");

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-prescription error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
