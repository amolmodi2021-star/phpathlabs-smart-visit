import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { abnormalResults, patientAge, patientGender } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a clinical laboratory quality assurance AI. Your job is to re-verify abnormal lab results.

For each abnormal result provided, check:
1. Whether the flag (H=High, L=Low) is correct based on the result value and reference range
2. Whether the result value seems plausible (not a data entry error)
3. Any clinical concerns

Patient context: Age: ${patientAge || "Unknown"}, Gender: ${patientGender || "Unknown"}

Return your analysis using the verify_abnormals tool.`;

    const userPrompt = `Re-verify these abnormal results:\n${JSON.stringify(abnormalResults, null, 2)}`;

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
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "verify_abnormals",
              description: "Return verification results for each abnormal parameter",
              parameters: {
                type: "object",
                properties: {
                  verifications: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        parameter_name: { type: "string" },
                        result_value: { type: "string" },
                        original_flag: { type: "string", description: "H or L" },
                        verified_flag: { type: "string", description: "H, L, or N if the flag was incorrect" },
                        flag_correct: { type: "boolean" },
                        plausible: { type: "boolean", description: "Whether the value seems plausible" },
                        comment: { type: "string", description: "Brief clinical note or concern" },
                      },
                      required: ["parameter_name", "result_value", "original_flag", "verified_flag", "flag_correct", "plausible", "comment"],
                      additionalProperties: false,
                    },
                  },
                  summary: { type: "string", description: "Overall summary of re-verification" },
                },
                required: ["verifications", "summary"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "verify_abnormals" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reverify error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
