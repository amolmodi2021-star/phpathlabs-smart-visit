import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TemplateMap {
  estimate_header: string;
  visit_confirmation_header: string;
  fasting_instructions: string;
  no_fasting_message: string;
  home_visit_disclaimer: string;
  footer_text: string;
}

const defaults: TemplateMap = {
  estimate_header: "PH PathLabs - Estimate",
  visit_confirmation_header: "PH PathLabs - Visit Confirmation",
  fasting_instructions: "8 to 10 hours of fasting is required.",
  no_fasting_message: "Fasting is not required for any of the above mentioned tests.",
  home_visit_disclaimer: "Home visit charges are not included and will be charged extra depending on your area of visit.",
  footer_text: "LabLine : 6356 55 66 99\nPH PathLabs - Vesu",
};

function formatDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${days[d.getDay()]} - ${dd}-${mm}-${yyyy}`;
}

function buildEstimateMsg(
  tests: { test_name: string; price: number; fasting_required: boolean }[],
  totalAmount: number,
  discountAmount: number,
  homeVisitCharges: number,
  finalAmount: number,
  t: TemplateMap,
  patientName: string | null,
  sentAt: string
): string {
  const dateStr = formatDate(new Date(sentAt));
  const fastingTests = tests.filter((x) => x.fasting_required).map((x) => x.test_name);

  let msg = `${t.estimate_header}\n${dateStr}\n`;
  if (patientName) msg += `\nPatient Name:\n${patientName.toUpperCase()}\n`;
  msg += `\nTest Details:\n`;
  tests.forEach((x) => { msg += `• ${x.test_name} – ₹${x.price}\n`; });
  msg += `\nAmount: ₹${totalAmount}`;
  if (discountAmount > 0) msg += `\nDiscount Amount: (₹${discountAmount})`;
  if (homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${homeVisitCharges}`;
  msg += `\nFinal Amount: ₹${finalAmount}`;
  if (fastingTests.length > 0) {
    msg += `\n\nFasting required for: ${fastingTests.join(", ")}\n${t.fasting_instructions}`;
  } else if (tests.length > 0) {
    msg += `\n\n${t.no_fasting_message}`;
  }
  if (homeVisitCharges === 0) {
    msg += `\n\n${t.home_visit_disclaimer}`;
  }
  msg += `\n\n${t.footer_text}`;
  return msg;
}

function buildVisitMsg(
  tests: { test_name: string; price: number; fasting_required: boolean }[],
  totalAmount: number,
  discountAmount: number,
  homeVisitCharges: number,
  finalAmount: number,
  t: TemplateMap,
  patientName: string | null,
  visitDate: string,
  visitTime: string,
  address: string
): string {
  const fastingTests = tests.filter((x) => x.fasting_required).map((x) => x.test_name);

  let msg = `${t.visit_confirmation_header}\n`;
  if (patientName) msg += `\nPatient Name:\n${patientName.toUpperCase()}\n`;
  msg += `\nVisit Date & Time:\n${visitDate} | ${visitTime}\n\nAddress:\n${address.toUpperCase()}\n\nTest Details:\n`;
  tests.forEach((x) => { msg += `• ${x.test_name} – ₹${x.price}\n`; });
  msg += `\nAmount: ₹${totalAmount}`;
  if (discountAmount > 0) msg += `\nDiscount Amount: (₹${discountAmount})`;
  if (homeVisitCharges > 0) msg += `\nHome Visit Charges: ₹${homeVisitCharges}`;
  msg += `\nFinal Amount: ₹${finalAmount}`;
  if (fastingTests.length > 0) {
    msg += `\n\nFasting required for: ${fastingTests.join(", ")}\n${t.fasting_instructions}`;
  } else if (tests.length > 0) {
    msg += `\n\n${t.no_fasting_message}`;
  }
  msg += `\n\nThank you for choosing us.\n${t.footer_text}`;
  return msg;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1. Fetch templates
  const { data: tplRows } = await supabase.from("message_templates").select("*");
  const tMap: Record<string, string> = {};
  (tplRows || []).forEach((r: any) => { tMap[r.template_key] = r.template_value; });
  const templates: TemplateMap = { ...defaults, ...tMap } as TemplateMap;

  // 2. Fetch null-content logs
  const { data: logs, error: logErr } = await supabase
    .from("message_send_log")
    .select("*")
    .in("message_type", ["Estimate", "Home Visit"])
    .is("message_content", null)
    .order("sent_at", { ascending: false });

  if (logErr) {
    return new Response(JSON.stringify({ error: logErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!logs || logs.length === 0) {
    return new Response(JSON.stringify({ updated: 0, message: "No null-content logs found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Get unique mobile numbers
  const mobiles = [...new Set(logs.map((l: any) => l.mobile_number))];

  // 4. Fetch estimates for those mobiles
  const { data: estimates } = await supabase
    .from("estimates")
    .select("*, estimate_tests(*)")
    .in("whatsapp_number", mobiles);

  // 5. Fetch home visits
  const estimateIds = (estimates || []).map((e: any) => e.id);
  const { data: homeVisits } = await supabase
    .from("home_visits")
    .select("*")
    .in("estimate_id", estimateIds.length > 0 ? estimateIds : ["__none__"]);

  // Index estimates by mobile
  const estByMobile: Record<string, any[]> = {};
  (estimates || []).forEach((e: any) => {
    const m = e.whatsapp_number;
    if (!estByMobile[m]) estByMobile[m] = [];
    estByMobile[m].push(e);
  });

  // Index home visits by estimate_id
  const hvByEstId: Record<string, any> = {};
  (homeVisits || []).forEach((hv: any) => { hvByEstId[hv.estimate_id] = hv; });

  let updated = 0;
  let skipped = 0;

  for (const log of logs) {
    const mobile = log.mobile_number;
    const sentAt = new Date(log.sent_at).getTime();
    const candidates = estByMobile[mobile] || [];

    if (candidates.length === 0) { skipped++; continue; }

    // Find closest estimate by timestamp
    let best: any = null;
    let bestDiff = Infinity;
    for (const est of candidates) {
      const diff = Math.abs(new Date(est.updated_at).getTime() - sentAt);
      if (diff < bestDiff) { bestDiff = diff; best = est; }
    }

    if (!best) { skipped++; continue; }

    const tests = (best.estimate_tests || []).map((t: any) => ({
      test_name: t.test_name,
      price: Number(t.price),
      fasting_required: t.fasting_required,
    }));

    let content: string;

    if (log.message_type === "Home Visit") {
      const hv = hvByEstId[best.id];
      if (!hv) {
        // Fallback to estimate message
        content = buildEstimateMsg(
          tests, Number(best.total_amount), Number(best.discount_amount),
          Number(best.home_visit_charges), Number(best.final_amount),
          templates, best.patient_name, log.sent_at
        );
      } else {
        content = buildVisitMsg(
          tests, Number(best.total_amount), Number(best.discount_amount),
          Number(best.home_visit_charges), Number(best.final_amount),
          templates, best.patient_name, hv.visit_date, hv.visit_time, hv.address
        );
      }
    } else {
      content = buildEstimateMsg(
        tests, Number(best.total_amount), Number(best.discount_amount),
        Number(best.home_visit_charges), Number(best.final_amount),
        templates, best.patient_name, log.sent_at
      );
    }

    const { error: updErr } = await supabase
      .from("message_send_log")
      .update({ message_content: content })
      .eq("id", log.id);

    if (!updErr) updated++;
    else skipped++;
  }

  return new Response(
    JSON.stringify({ total: logs.length, updated, skipped }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
