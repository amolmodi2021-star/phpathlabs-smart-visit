import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-ph-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOL_NAME = "cbc_smear_interpretation";

const toolParameters = {
  type: "object",
  properties: {
    neutrophils_pct: {
      type: "string",
      description: "Neutrophil % as a number string; differential should sum ~100",
    },
    lymphocytes_pct: { type: "string", description: "Lymphocyte % as a number string" },
    monocytes_pct: { type: "string", description: "Monocyte % as a number string" },
    eosinophils_pct: { type: "string", description: "Eosinophil % as a number string" },
    basophils_pct: { type: "string", description: "Basophil % as a number string" },
    wbc_morphology: {
      type: "string",
      description: "WBC morphology - prefer an option from the lab WBC list",
    },
    rbc_morphology: {
      type: "string",
      description: "RBC morphology - prefer an option from the lab RBC list",
    },
    platelet_morphology: {
      type: "string",
      description: "Platelet morphology - prefer an option from the lab platelet list",
    },
    malarial_parasites: {
      type: "string",
      description: 'Prefer "Not detected" or "Detected", or closest option from MP list',
    },
    blasts: { type: "string", description: "CRITICAL ONLY. Leave empty string for routine smears. Fill only if blasts are clearly present in a critical case." },
    promyelocytes: { type: "string", description: "CRITICAL ONLY. Empty unless clearly present in a critical case." },
    myelocytes: { type: "string", description: "CRITICAL ONLY. Empty unless clearly present in a critical case." },
    metamyelocyte: { type: "string", description: "CRITICAL ONLY. Empty unless clearly present in a critical case." },
    band_cells: { type: "string", description: "CRITICAL ONLY. Empty for routine smears; fill only for significant left shift / critical case." },
    normoblast: { type: "string", description: "CRITICAL ONLY. Empty unless nRBCs/normoblasts clearly present in a critical case." },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Overall confidence in this assistive draft",
    },
    notes: {
      type: "string",
      description: "Short pathologist-style note for the tech",
    },
  },
  required: [
    "neutrophils_pct",
    "lymphocytes_pct",
    "monocytes_pct",
    "eosinophils_pct",
    "basophils_pct",
    "wbc_morphology",
    "rbc_morphology",
    "platelet_morphology",
    "malarial_parasites",
    "confidence",
    "notes",
  ],
};

function buildModelList(override?: string | null): string[] {
  const preferred = (override && override.trim()) || Deno.env.get("OPENAI_CBC_MODEL") || "gpt-5.6-sol";
  const fallbacks = ["gpt-5.4", "gpt-4.1", "gpt-4o"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [preferred, ...fallbacks]) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function needsReasoningEffortNone(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("gpt-5") || m.includes("o3") || m.includes("o4");
}

/** Retry next model on not-found / unsupported tool+reasoning / unsupported params. */
function shouldTryNextModel(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const lower = bodyText.toLowerCase();
  return (
    lower.includes("model_not_found") ||
    lower.includes("does not exist") ||
    lower.includes("not found") ||
    lower.includes("reasoning_effort") ||
    lower.includes("function tools") ||
    lower.includes("unsupported_parameter") ||
    lower.includes("unsupported parameter") ||
    lower.includes("invalid model")
  );
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: secretRow } = await supabase
      .from("ai_api_secrets")
      .select("api_key, model_override")
      .eq("provider", "openai")
      .maybeSingle();
    const OPENAI_API_KEY = String(secretRow?.api_key || Deno.env.get("OPENAI_API_KEY") || "").trim();
    if (!OPENAI_API_KEY) {
      throw new Error(
        "OpenAI API key not set. Add it in LIMS ? Settings ? OpenAI, or set OPENAI_API_KEY edge secret.",
      );
    }
    const settingsModel = String(secretRow?.model_override || "").trim();
    const imageUrlsRaw: string[] = Array.isArray(body?.imageUrls) ? body.imageUrls : [];
    const imageUrls = imageUrlsRaw.filter((u) => typeof u === "string" && u.trim()).slice(0, 15);
    const analyzerContext: Record<string, string> =
      body?.analyzerContext && typeof body.analyzerContext === "object" ? body.analyzerContext : {};
    const morphologyOptions = {
      wbc: Array.isArray(body?.morphologyOptions?.wbc) ? body.morphologyOptions.wbc : [],
      rbc: Array.isArray(body?.morphologyOptions?.rbc) ? body.morphologyOptions.rbc : [],
      platelet: Array.isArray(body?.morphologyOptions?.platelet) ? body.morphologyOptions.platelet : [],
      mp: Array.isArray(body?.morphologyOptions?.mp) ? body.morphologyOptions.mp : [],
    };
    const missingFields: string[] = Array.isArray(body?.missingFields) ? body.missingFields : [];

    if (imageUrls.length === 0) {
      throw new Error("At least one smear image URL is required");
    }

    const analyzerLines = Object.entries(analyzerContext)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const systemPrompt = `You are an expert hematology peripheral smear reviewer assisting a laboratory technologist at PH PathLabs.
You receive (a) analyzer/machine CBC values already entered in Result Verification and (b) peripheral smear microscope images.

RULES ? DIFFERENTIAL COUNT (DC %):
1) Always return Neutrophils %, Lymphocytes %, Monocytes %, Eosinophils %, Basophils % as WHOLE number strings (no decimals). Round UP to the next integer if needed.
2) The five DC percentages MUST sum to exactly 100 (integer total).
3) If analyzer context already has Neutrophils and/or Lymphocytes, KEEP those machine values. Do not replace them from images.
4) Only estimate from smear images the DC cells that are missing/empty in analyzer context (commonly Monocytes / Eosinophils / Basophils; sometimes Neutrophils or Lymphocytes when machine did not send them).
5) After keeping machine values and filling missing ones, adjust the estimated cells so the total is exactly 100. Do not change kept machine Neutrophils/Lymphocytes unless that makes an exact 100 impossible ? then adjust only the estimated cells.
6) Basophils are usually 0 on most reports. Default Basophils to 0 unless the smear clearly shows basophils.

RULES ? MORPHOLOGY (lab style):
1) You MUST base wording on the lab morphology option lists provided (WBC / RBC / Platelet).
2) Prefer an exact option from the list. You MAY only adjust severity markers like +, ++, +++ (e.g. Hypochromia+ ? Hypochromia++) when the smear warrants it ? same style as this lab uses.
3) Do NOT invent a completely different free-text morphology style. Stay close to the lab's phrasing.
4) Malarial parasites: prefer "Not detected" or "Detected", or the closest option from the MP list.

RULES ? CRITICAL-ONLY (Blasts, Promyelocytes, Myelocytes, Metamyelocyte, Band Cells, Normoblast):
- For routine / non-critical smears return empty strings for ALL of these.
- Do NOT invent "0", "Nil", "Not seen", or "Adequate" ? use "".
- Populate ONLY when the case is critical (clear blasts, significant left shift, definite normoblasts/nRBCs).

This is an assistive draft for the tech to review/approve ? not a final sign-out. Be concise in notes.
Prioritize filling missing/empty fields listed by the lab; keep existing analyzer values.`;

    const userText = [
      "Interpret these peripheral smear microscope images for CBC differential, morphology, and malaria parasites.",
      "",
      "Analyzer CBC context:",
      analyzerLines || "(none provided)",
      "",
      "Lab morphology options (MUST stay in this style; only +/++/+++ may change):",
      `WBC: ${JSON.stringify(morphologyOptions.wbc)}`,
      `RBC: ${JSON.stringify(morphologyOptions.rbc)}`,
      `Platelet: ${JSON.stringify(morphologyOptions.platelet)}`,
      `MP: ${JSON.stringify(morphologyOptions.mp)}`,
      "",
      "Instructions:",
      "- Keep any Neutrophils/Lymphocytes (and other DC values) already present in analyzer context.",
      "- Use smear images mainly for missing DC cells, morphology (+/++ adjustments allowed on lab options), and malaria.",
      "- DC % must be whole numbers (no decimals) and total exactly 100. Basophils usually 0 unless smear shows otherwise.",
      missingFields.length
        ? `Missing / empty fields to prioritize: ${missingFields.join(", ")}`
        : "Analyzer already has most fields ? refine morphology/MP and only fill gaps; keep existing DC machine values.",
    ].join("\n");

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: userText },
      ...imageUrls.map((url) => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      })),
    ];

    const requestBodyBase = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: TOOL_NAME,
            description:
              "Return CBC peripheral smear interpretation draft for the lab tech to review",
            parameters: toolParameters,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: TOOL_NAME } },
    };

    const models = buildModelList(settingsModel);
    let lastErrorText = "";
    let usedModel = models[0];
    let data: any = null;

    for (const model of models) {
      usedModel = model;
      const payload: Record<string, unknown> = { ...requestBodyBase, model };
      // gpt-5.x chat.completions + function tools requires reasoning_effort none
      if (needsReasoningEffortNone(model)) {
        payload.reasoning_effort = "none";
      }
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        data = await response.json();
        break;
      }

      const text = await response.text();
      lastErrorText = text;

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "OpenAI API key rejected. Check LIMS ? Settings ? OpenAI." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (shouldTryNextModel(response.status, text)) {
        console.warn(`Model unavailable (${model}), trying next...`, text.slice(0, 240));
        continue;
      }

      console.error("OpenAI error:", response.status, text);
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message || detail;
      } catch {
        /* keep raw */
      }
      throw new Error(`AI processing failed: ${detail}`);
    }

    if (!data) {
      console.error("All models failed. Last error:", lastErrorText);
      throw new Error("AI processing failed - no available model");
    }

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No results from AI");

    const args =
      typeof toolCall.function?.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function?.arguments;

    return new Response(JSON.stringify({ ...args, model_used: usedModel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("interpret-cbc-smear error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
