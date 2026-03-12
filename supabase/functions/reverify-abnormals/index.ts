import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE_DEFAULT = 4;
const CHUNK_SIZE_STRICT = 2;

const buildRowKey = (row: any, index = 0) => {
  const parameter = String(row?.parameter_name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const testName = String(row?.test_name ?? row?.parameter_name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const sourcePage = Number(row?.source_page) || 0;
  return `${parameter || `row-${index}`}|${testName}|${sourcePage}`;
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

async function verifyChunk(
  pageImages: string[],
  pageTexts: string[],
  pageNumbers: number[],
  chunk: any[],
  LOVABLE_API_KEY: string,
  strictMode: boolean,
): Promise<any[]> {
  const pageTextContext = buildPageTextContext(pageTexts, pageNumbers);

  const resultsList = chunk
    .map((row: any, i: number) => {
      const pageHint = Number(row?.source_page) || "unknown";
      const range = row?.normal_range_text || `${row?.normal_range_low || ""}-${row?.normal_range_high || ""}`;
      return `${i + 1}. [page_hint=${pageHint}] "${row?.parameter_name}" | result="${row?.result_value}" | unit="${row?.unit || ""}" | range="${range}"`;
    })
    .join("\n");

  const systemPrompt = `You are a pathology report re-verification engine.

MISSION:
Re-verify each parameter row-by-row with maximum precision.

STRICT RULES:
1) Use provided TEXT LAYER as primary source when available; use image to confirm visually.
2) Stay on the SAME row (same Y-line) for parameter, result, unit, and reference range.
3) Read numeric results character-by-character to avoid 0/6/9, 3/8, 5/6 confusion.
4) Never copy numbers from adjacent rows or from reference range into result_value.
5) Preserve complete range text exactly as printed; do not truncate risk categories.
6) Return source_page for every row and confidence_score (0-100).
7) If uncertain, keep original values and lower confidence.

MODE:
${strictMode ? "STRICT MODE ON: prioritize precision over speed." : "STANDARD MODE: high precision with balanced speed."}

ROWS TO VERIFY (${chunk.length}):
${resultsList}`;

  const userContent: any[] = [
    {
      type: "text",
      text: `Verify these ${chunk.length} rows only. Use page_hint when available. Return corrected data with confidence_score.`,
    },
  ];

  if (pageTextContext) {
    userContent.push({
      type: "text",
      text: `TEXT LAYER CONTEXT:\n${pageTextContext}`,
    });
  }

  userContent.push(
    ...pageImages.map((img) => ({
      type: "image_url",
      image_url: { url: img },
    })),
  );

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: strictMode ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_verified_results",
            description: "Return row-verified pathology results",
            parameters: {
              type: "object",
              properties: {
                verified_results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      parameter_name: { type: "string" },
                      result_value: { type: "string" },
                      unit: { type: "string" },
                      normal_range_text: { type: "string" },
                      normal_range_low: { type: "string" },
                      normal_range_high: { type: "string" },
                      source_page: { type: "number" },
                      confidence_score: { type: "number" },
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
  });

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

  const parsed = JSON.parse(toolCall.function.arguments || "{}");
  const fallbackPage = Number(pageNumbers?.[0] ?? 1) || 1;

  return (parsed.verified_results || []).map((row: any) => ({
    ...row,
    source_page: Number(row?.source_page) || fallbackPage,
    confidence_score: clampConfidence(row?.confidence_score),
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageImages, pageTexts, pageNumbers, testResults, strictMode } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!Array.isArray(pageImages) || pageImages.length === 0 || !Array.isArray(testResults) || testResults.length === 0) {
      throw new Error("Both pageImages and testResults are required");
    }

    const normalizedPageTexts = Array.isArray(pageTexts) ? pageTexts : [];
    const normalizedPageNumbers = Array.isArray(pageNumbers)
      ? pageNumbers.map((n: any, idx: number) => Number(n) || idx + 1)
      : pageImages.map((_: any, idx: number) => idx + 1);

    const chunkSize = strictMode ? CHUNK_SIZE_STRICT : CHUNK_SIZE_DEFAULT;
    const verifiedMap = new Map<string, any>();

    for (let i = 0; i < testResults.length; i += chunkSize) {
      const chunk = testResults.slice(i, i + chunkSize);
      const chunkLabel = `${Math.floor(i / chunkSize) + 1}/${Math.ceil(testResults.length / chunkSize)}`;
      console.log(`Re-verifying chunk ${chunkLabel} with ${chunk.length} rows`);

      try {
        const verifiedRows = await verifyChunk(
          pageImages,
          normalizedPageTexts,
          normalizedPageNumbers,
          chunk,
          LOVABLE_API_KEY,
          Boolean(strictMode),
        );

        verifiedRows.forEach((row: any, idx: number) => {
          verifiedMap.set(buildRowKey(row, idx), row);
        });
      } catch (e: any) {
        if (e.status === 429) {
          console.log("Rate limited, retrying in 3s...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            const retryRows = await verifyChunk(
              pageImages,
              normalizedPageTexts,
              normalizedPageNumbers,
              chunk,
              LOVABLE_API_KEY,
              Boolean(strictMode),
            );
            retryRows.forEach((row: any, idx: number) => {
              verifiedMap.set(buildRowKey(row, idx), row);
            });
          } catch (retryError) {
            console.error(`Chunk failed after retry: ${chunkLabel}`, retryError);
          }
        } else if (e.status === 402) {
          return new Response(
            JSON.stringify({
              error: "AI credits exhausted. Please add credits.",
              verified_results: Array.from(verifiedMap.values()),
            }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } else {
          console.error(`Chunk failed: ${chunkLabel}`, e);
        }
      }
    }

    const untouchedRows = testResults
      .filter((row: any, idx: number) => !verifiedMap.has(buildRowKey(row, idx)))
      .map((row: any) => ({
        ...row,
        confidence_score: clampConfidence(row?.confidence_score),
      }));

    const verifiedResults = [...Array.from(verifiedMap.values()), ...untouchedRows];

    return new Response(JSON.stringify({ verified_results: verifiedResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reverify-abnormals error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
