import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, availableTests } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error("Set GEMINI_API_KEY or OPENAI_API_KEY in Supabase Edge Function secrets");
    }

    const testListStr = availableTests.map((t: any) => `${t.id}|${t.test_name}`).join("\n");

    const systemPrompt = `You are an expert medical prescription reader specializing in Indian diagnostic lab test matching. Your job: read handwritten/printed prescriptions and map each recommended test to the closest match from our lab's test catalog.

AVAILABLE TESTS (format: ID|Name):
${testListStr}

CRITICAL MATCHING RULES - Doctors use heavy abbreviations. You MUST know these:
- "CBC" / "CBP" / "TC DC" / "Hb" → Complete Blood Count / Complete Blood Picture / Hemogram
- "LFT" / "Liver" → Liver Function Test
- "KFT" / "RFT" / "Renal" → Kidney Function Test / Renal Function Test
- "TFT" / "Thyroid" → Thyroid Function Test / Thyroid Profile
- "Creat" / "S.Creat" / "Sr Creatinine" → Creatinine / Serum Creatinine
- "Urine R/M" / "Urine R/E" / "U/R" / "Urine Routine" → Urine Routine / Urine Analysis
- "HbA1c" / "A1c" / "Glyco Hb" → Glycosylated Hemoglobin / HbA1c
- "FBS" / "Fasting Sugar" → Fasting Blood Sugar / Fasting Glucose
- "PPBS" / "PP Sugar" / "PP" → Post Prandial Blood Sugar
- "RBS" / "Random Sugar" / "Grbs" → Random Blood Sugar
- "ESR" → Erythrocyte Sedimentation Rate
- "CRP" → C-Reactive Protein
- "Lipid" / "Lipid Profile" → Lipid Profile
- "TSH" → TSH / Thyroid Stimulating Hormone
- "T3 T4" → T3 T4 / Thyroid Profile
- "Uric Acid" / "S.Uric Acid" → Serum Uric Acid
- "Ca" / "Calcium" → Serum Calcium
- "Vit D" / "25 OH" / "Vitamin D" → Vitamin D / 25-Hydroxy Vitamin D
- "Vit B12" / "B12" → Vitamin B12
- "Iron" / "S.Iron" / "Iron Studies" → Serum Iron / Iron Profile
- "PT INR" / "PT" / "Coag" → PT INR / Prothrombin Time
- "Widal" → Widal Test
- "Dengue" / "NS1" → Dengue NS1 / Dengue Test
- "Malaria" / "MP" / "Peripheral Smear" → Malaria / Peripheral Smear
- "Electrolytes" / "Na K Cl" → Serum Electrolytes
- "PSA" → PSA / Prostate Specific Antigen
- "ANA" → ANA / Anti Nuclear Antibody
- "RA Factor" / "RF" → RA Factor / Rheumatoid Factor
- "ASO" → ASO Titre / Anti Streptolysin O
- "Stool R/M" / "Stool R/E" → Stool Routine
- "Blood Group" / "BG" / "Grouping" → Blood Grouping
- "Bilirubin" / "S.Bili" → Serum Bilirubin
- "Urea" / "BUN" → Blood Urea / BUN
- "SGOT" / "AST" → SGOT / AST
- "SGPT" / "ALT" → SGPT / ALT
- "ALP" → Alkaline Phosphatase
- "GGT" → Gamma GT / GGT
- "Amylase" / "Lipase" → Serum Amylase / Serum Lipase

MATCHING STRATEGY:
1. Read the prescription carefully - doctors have poor handwriting, look for context clues
2. For each test written, find the BEST match from our catalog using fuzzy/partial matching
3. Even 2-3 letter abbreviations should be matched confidently if they clearly map to a test
4. If a written test partially matches a test name (e.g., "Creat" matches "Creatinine"), mark as HIGH confidence
5. Only mark as unmatched if there is truly no reasonable match in our catalog
6. Extract patient name if visible`;

    const aiUrl = GEMINI_API_KEY
      ? `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
      : "https://api.openai.com/v1/chat/completions";
    const aiKey = GEMINI_API_KEY || OPENAI_API_KEY!;
    const model = GEMINI_API_KEY ? "gemini-2.0-flash" : "gpt-4o-mini";

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
