import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-ph-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOL_NAME = "doctor_one_pager";

const toolParameters = {
  type: "object",
  properties: {
    overall_clinical_snapshot: { type: "string" },
    clinical_patterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          pattern_name: { type: "string" },
          current_findings: { type: "array", items: { type: "string" } },
          related_parameters_considered: { type: "array", items: { type: "string" } },
          historical_context: { type: "string" },
          status: {
            type: "string",
            enum: ["NEW", "PERSISTENT", "WORSENING", "IMPROVING", "STABLE", "RESOLVED", "ISOLATED", "INDETERMINATE"],
          },
          integrated_interpretation: { type: "string" },
          clinical_correlation: { type: "array", items: { type: "string" } },
        },
        required: ["pattern_name", "current_findings", "status", "integrated_interpretation"],
      },
    },
    important_isolated_findings: { type: "array", items: { type: "string" } },
    historical_changes: {
      type: "object",
      properties: {
        new: { type: "array", items: { type: "string" } },
        worsening: { type: "array", items: { type: "string" } },
        improving: { type: "array", items: { type: "string" } },
        stable: { type: "array", items: { type: "string" } },
        resolved: { type: "array", items: { type: "string" } },
      },
    },
    points_for_clinical_review: { type: "array", items: { type: "string" } },
    reference_ids: {
      type: "array",
      items: {
        type: "string",
        enum: ["ada", "nhlbi-lipid", "kdigo", "niddk-thyroid", "aasld", "who-anaemia", "endocrine", "nih-b12"],
      },
    },
    suggested_follow_up: {
      type: "array",
      items: {
        type: "object",
        properties: {
          test: { type: "string" },
          when: { type: "string" },
          note: { type: "string" },
        },
        required: ["test", "when"],
      },
    },
    overall_comment: { type: "string" },
  },
  required: ["overall_clinical_snapshot", "clinical_patterns", "points_for_clinical_review"],
};

function buildModelList(override?: string | null): string[] {
  const preferred = (override && override.trim()) || Deno.env.get("OPENAI_CBC_MODEL") || "gpt-5.4";
  const fallbacks = ["gpt-4.1", "gpt-4o"];
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

const SYSTEM_PROMPT = `You prepare a one-page doctor-facing laboratory summary for PH PathLabs.
You are given current verified results already grouped with clinically related parameters, including NORMAL related values, plus prior values for the same patient.

Reason in this order only: individual result, related parameters in the same group, the pattern they form together, then history.

Rules:
- Do NOT list each abnormal test as its own finding. Combine related results into one pattern.
- Use normal related values. If FBS is high but PPBS and HbA1c are normal, call it an isolated fasting elevation, not a diabetes pattern.
- If the values do not form a pattern, use status ISOLATED or INDETERMINATE. Do not invent a pattern.
- History status must be one of NEW, PERSISTENT, WORSENING, IMPROVING, STABLE, RESOLVED, ISOLATED, INDETERMINATE. If history is empty, do not claim a trend; use INDETERMINATE or ISOLATED.
- Use only the numbers, units, ranges and flags provided. Never invent values, ranges, symptoms or history.
- Laboratory flags H and L are the lab flags. Do not invent critical or panic thresholds.
- Never diagnose. Never prescribe. Never mention drugs, doses, starting or stopping medication.
- Use cautious wording: suggests, consistent with, pattern of, correlate clinically.
- Avoid: patient has, definitely, confirmed diagnosis, must take.
- Keep it scannable in 20-30 seconds. Maximum 4 patterns. Snapshot is at most 2 short sentences.
- Each current finding is the parameter name only, such as "Total Cholesterol" or "Vitamin D". Do not put the value, unit, or reference range in current_findings. The page shows those in a table from the laboratory record.
- Say "result is low" or "result is high". Never write "by lab", "flagged by lab", or "low by lab".
- If no earlier result exists, write "Prior history for <test or panel name> not available." Never write "no prior results provided" or "no previous results".
- Never mention sample contamination, haemolysis, clotting, insufficient sample, laboratory error, pre-analytical problems, or any wording that could be read as a fault in the sample or the laboratory.
- integrated_interpretation is one sentence.
- points_for_clinical_review: at most 4 short correlation points, not a treatment plan.
- suggested_follow_up: 2 to 4 laboratory tests that would help the doctor, only when an abnormal pattern makes them relevant. Each item has test (the investigation), when (a concrete interval such as "after 6-8 weeks" or "after 3 months"), and note (one short reason). These are repeat or additional laboratory tests, not medicines and not a treatment plan. Do not invent a follow-up when the available results do not support one.
- Omit minor isolated noise. Prefer concordant patterns, then persistent or worsening change, then important isolated findings.
- Do not reproduce charts.
- Base the clinical comments only on the verified results and these published sources. Do not invent a website, paper, or URL.
- reference_ids: include only the ids you actually used, and only when that topic appears in the results:
  ada — American Diabetes Association, Standards of Care in Diabetes. https://professional.diabetes.org/standards-of-care
  nhlbi-lipid — National Heart, Lung, and Blood Institute, Blood Cholesterol. https://www.nhlbi.nih.gov/health/blood-cholesterol
  kdigo — KDIGO, CKD Evaluation and Management. https://kdigo.org/guidelines/ckd-evaluation-and-management/
  niddk-thyroid — NIDDK, Thyroid. https://www.niddk.nih.gov/health-information/endocrine-diseases/hypothyroidism
  aasld — American Association for the Study of Liver Diseases, Practice Guidelines. https://www.aasld.org/practice-guidelines
  who-anaemia — World Health Organization, Anaemia. https://www.who.int/news-room/fact-sheets/detail/anaemia
  endocrine — Endocrine Society, Clinical Practice Guidelines. https://www.endocrine.org/clinical-practice-guidelines
  nih-b12 — NIH Office of Dietary Supplements, Vitamin B12. https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/`;

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
      throw new Error("OpenAI API key not set. Add it in LIMS Settings, OpenAI.");
    }

    const userText = [
      "Prepare the doctor one-pager from this grouped laboratory JSON.",
      "Groups already contain related parameters, including normals. Interpret each group as a set.",
      "Parameters may also carry a panel id so same-test siblings stay together.",
      "",
      JSON.stringify(body),
    ].join("\n");

    const requestBodyBase = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: TOOL_NAME,
            description: "Return the structured doctor laboratory one-pager",
            parameters: toolParameters,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: TOOL_NAME } },
    };

    const models = buildModelList(String(secretRow?.model_override || ""));
    let lastErrorText = "";
    let data: any = null;
    for (const model of models) {
      const payload: Record<string, unknown> = { ...requestBodyBase, model };
      if (needsReasoningEffortNone(model)) payload.reasoning_effort = "none";
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
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 401) {
        return new Response(JSON.stringify({ error: "OpenAI API key rejected. Check LIMS Settings, OpenAI." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (shouldTryNextModel(response.status, text)) continue;
      let detail = text.slice(0, 300);
      try {
        detail = JSON.parse(text)?.error?.message || detail;
      } catch {
        /* keep */
      }
      throw new Error(`AI processing failed: ${detail}`);
    }
    if (!data) throw new Error(lastErrorText.slice(0, 240) || "AI processing failed");
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No summary returned");
    const args = typeof toolCall.function?.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments;
    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("doctor-one-pager error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});