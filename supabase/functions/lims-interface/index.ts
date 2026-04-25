import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Strip any trailing unit token the interface concatenated into the value field.
// Some analyzers (e.g. Sysmex) send value as "5.03 10*6/uL" instead of separating
// the numeric and unit. We always strip so the stored result_value stays clean,
// regardless of whether unit_conversion is enabled.
function sanitizeInterfaceValue(rawValue: string | null | undefined, interfaceUnit: string | null | undefined): string {
  const raw = rawValue == null ? "" : String(rawValue).trim();
  if (!raw) return raw;
  // 1) If the interface also sent a unit, strip an exact trailing match.
  const u = (interfaceUnit || "").toString().trim();
  let cleaned = raw;
  if (u) {
    const lower = cleaned.toLowerCase();
    const uLower = u.toLowerCase();
    if (lower.endsWith(uLower)) {
      cleaned = cleaned.slice(0, cleaned.length - u.length).trim();
    }
  }
  // 2) If the head is numeric, drop any trailing non-numeric token (e.g. "10*3/uL").
  //    Matches an optional sign, digits, optional decimal, optional exponent.
  const numMatch = cleaned.match(/^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/);
  if (numMatch) {
    const tail = cleaned.slice(numMatch[0].length).trim();
    // Only strip the tail if it looks unit-like (contains letters, *, /, ^, %)
    if (tail && /[A-Za-z*/^%µμ]/.test(tail)) {
      cleaned = numMatch[1];
    }
  }
  return cleaned;
}

// Apply per-parameter unit conversion (configured in Test Management).
// Leaves non-numeric values (e.g. "POSITIVE") and disabled-conversion params untouched.
// Always sanitizes the incoming value first so concatenated unit suffixes never leak through.
function applyUnitConversion(rawValue: string | null | undefined, param: any, interfaceUnit?: string | null): string {
  const cleaned = sanitizeInterfaceValue(rawValue, interfaceUnit);
  if (!param?.unit_conversion_enabled) return cleaned;
  const factor = Number(param.unit_conversion_value);
  if (!factor || isNaN(factor)) return cleaned;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return cleaned;
  const converted = param.unit_conversion_operator === "/" ? num / factor : num * factor;
  return Number(converted.toFixed(4)).toString();
}

// Compute a flag value consistent with the UI rule:
// - Numeric value with numeric bounds → H/L/N
// - Otherwise (qualitative/descriptive), compare against normal_range_text
//   → match = "N", mismatch = "X" (highlight only, no badge), empty ref = ""
function computeFlagFromInterface(rawValue: string, param: any): string {
  const value = (rawValue ?? "").toString().trim();
  if (!value) return "";

  const num = parseFloat(value);
  if (!isNaN(num) && param?.normal_range_low != null && param?.normal_range_high != null) {
    if (num < Number(param.normal_range_low)) return "L";
    if (num > Number(param.normal_range_high)) return "H";
    return "N";
  }

  const ref = (param?.normal_range_text ?? "").toString().trim().toLowerCase();
  if (!ref) return "";
  return value.toLowerCase() === ref ? "N" : "X";
}

// Apply unit suffix to result_value ONLY when the parameter is "undefined"-range
// AND a unit is configured in Test Management. The unit value sent by the interface
// is intentionally ignored — Test Management is the single source of truth for units.
// `_isUndefinedRange` is attached to the param object after fetching parameter_normal_ranges.
function applyInterfaceUnitSuffix(value: string, param: any): string {
  if (!value) return value;
  if (!param?._isUndefinedRange) return value;
  const u = (param?.unit || "").toString().trim();
  if (!u) return value;
  const trimmed = value.trim();
  if (trimmed.toLowerCase().endsWith(u.toLowerCase())) return trimmed;
  return `${trimmed} ${u}`;
}

// Resolve per-parameter "is undefined range" flag from parameter_normal_ranges.
// A parameter is treated as undefined-range only if it has at least one range row
// AND every range row uses range_type='undefined'.
async function attachUndefinedRangeFlag(supabase: any, paramRows: any[]) {
  const ids = (paramRows || []).map((p) => p.id);
  if (ids.length === 0) return;
  const { data: rangeRows } = await supabase
    .from("parameter_normal_ranges")
    .select("parameter_id, range_type")
    .in("parameter_id", ids);
  const byParam: Record<string, string[]> = {};
  for (const r of rangeRows || []) {
    const pid = r.parameter_id as string;
    if (!byParam[pid]) byParam[pid] = [];
    byParam[pid].push((r.range_type || "numeric") as string);
  }
  for (const p of paramRows) {
    const types = byParam[p.id] || [];
    p._isUndefinedRange = types.length > 0 && types.every((t) => t === "undefined");
  }
}

// ─── Evaluate a calculation_formula token list against a paramId→value map ───
// Mirrors the client-side evaluator in ResultsEntry.tsx so server-side auto-calc
// produces the same numeric value the user would see if they clicked "Recalculate".
function evaluateFormulaServer(formula: any[], paramValues: Record<string, string>): string {
  if (!Array.isArray(formula) || formula.length === 0) return "";
  try {
    let expr = "";
    for (let idx = 0; idx < formula.length; idx++) {
      const token = formula[idx];
      if (!token || typeof token !== "object") continue;
      if (token.type === "bracket_open") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        expr += "(";
      } else if (token.type === "bracket_close") {
        expr += ")";
      } else if (token.type === "parameter") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        const val = paramValues[token.parameter_id];
        if (!val) return "";
        const num = parseFloat(val);
        if (isNaN(num)) return "";
        expr += num;
      } else if (token.type === "fixed_value" || token.type === "fixed") {
        if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
        expr += token.fixed_value ?? token.value ?? "";
      }
    }
    expr = expr.replace(/\s+/g, " ").trim();
    if (!expr) return "";
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${expr})`)();
    if (typeof result === "number" && isFinite(result)) {
      return parseFloat(result.toFixed(2)).toString();
    }
    return "";
  } catch {
    return "";
  }
}

// ─── Auto-calculate dependent parameters after interface push ───
// For the given registration, finds every calculated parameter (is_calculated=true
// with a calculation_formula) belonging to a test that already has at least one
// stored result, evaluates the formula against current patient_results values,
// and upserts the computed value (status='pending', is_calculated=true) so the
// user no longer has to click the Calculator button. Iterates up to 3 passes so
// calc-of-calc parameters resolve in one bridge call.
async function autoCalcDependentParams(supabase: any, registrationId: string): Promise<number> {
  if (!registrationId) return 0;
  let totalWritten = 0;
  try {
    // Load all stored patient_results for this registration
    const { data: storedRows } = await supabase
      .from("patient_results")
      .select("id, parameter_id, test_id, result_value, status")
      .eq("registration_id", registrationId);
    const stored = (storedRows || []) as any[];
    if (stored.length === 0) return 0;

    const testIds = Array.from(new Set(stored.map((r) => r.test_id).filter(Boolean)));
    if (testIds.length === 0) return 0;

    // Load test_parameters + parameter metadata for these tests
    const { data: tpRows } = await supabase
      .from("test_parameters")
      .select("test_id, parameter_id, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula)")
      .in("test_id", testIds);
    const calcParams: any[] = [];
    for (const tp of (tpRows || []) as any[]) {
      const p = tp.report_test_parameters;
      if (!p || !p.is_calculated) continue;
      const formula = p.calculation_formula;
      if (!Array.isArray(formula) || formula.length === 0) continue;
      calcParams.push({ testId: tp.test_id, param: p });
    }
    if (calcParams.length === 0) return 0;

    // Build paramId → value map (skip empty values)
    const valueMap: Record<string, string> = {};
    const existingByParam: Record<string, any> = {};
    for (const r of stored) {
      existingByParam[r.parameter_id] = r;
      if (r.result_value != null && String(r.result_value).trim() !== "") {
        valueMap[r.parameter_id] = String(r.result_value);
      }
    }

    const nowIso = new Date().toISOString();
    // Up to 3 passes for chained calculations
    for (let pass = 0; pass < 3; pass++) {
      let changed = 0;
      for (const { testId, param } of calcParams) {
        const computed = evaluateFormulaServer(param.calculation_formula, valueMap);
        if (!computed) continue;
        const existing = existingByParam[param.id];
        // Don't overwrite once technician/verifier/approver has touched it
        if (existing && existing.status && existing.status !== "pending") continue;
        if (existing && String(existing.result_value || "") === computed) continue;

        const refRange = param.normal_range_text
          || (param.normal_range_low != null && param.normal_range_high != null
              ? `${param.normal_range_low} - ${param.normal_range_high}`
              : "");
        const num = parseFloat(computed);
        let flag = "";
        if (!isNaN(num)) {
          if (param.normal_range_low != null && num < Number(param.normal_range_low)) flag = "L";
          else if (param.normal_range_high != null && num > Number(param.normal_range_high)) flag = "H";
          else if (param.normal_range_low != null || param.normal_range_high != null) flag = "N";
        }

        if (existing) {
          const { error } = await supabase
            .from("patient_results")
            .update({
              result_value: computed,
              flag,
              unit: param.unit || "",
              reference_range: refRange,
              normal_range_low: param.normal_range_low,
              normal_range_high: param.normal_range_high,
              is_calculated: true,
              status: "pending",
              entered_at: nowIso,
              entered_by: existing.entered_by || "AUTO-CALC",
              updated_at: nowIso,
            })
            .eq("id", existing.id);
          if (!error) {
            existing.result_value = computed;
            existing.status = "pending";
            valueMap[param.id] = computed;
            totalWritten++;
            changed++;
          }
        } else {
          const insertRow = {
            registration_id: registrationId,
            test_id: testId,
            parameter_id: param.id,
            param_code: param.param_code,
            parameter_name: param.parameter_name,
            result_value: computed,
            unit: param.unit || "",
            reference_range: refRange,
            normal_range_low: param.normal_range_low,
            normal_range_high: param.normal_range_high,
            flag,
            status: "pending",
            is_calculated: true,
            is_from_interface: false,
            entered_at: nowIso,
            entered_by: "AUTO-CALC",
          };
          const { data: inserted, error } = await supabase
            .from("patient_results")
            .insert(insertRow)
            .select("id, parameter_id, result_value, status")
            .single();
          if (!error && inserted) {
            existingByParam[param.id] = inserted;
            valueMap[param.id] = computed;
            totalWritten++;
            changed++;
          }
        }
      }
      if (changed === 0) break;
    }
  } catch (err) {
    console.error("autoCalcDependentParams error:", err);
  }
  return totalWritten;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const url = new URL(req.url);

    // POST reprocess action — re-bridge already-received lims_test_results into patient_results
    // for active orders. Optional `registration_id` filter scopes to a single patient.
    if (req.method === "POST") {
      // Peek at body without consuming if it's not a reprocess call
      const cloned = req.clone();
      let peekBody: any = null;
      try { peekBody = await cloned.json(); } catch { /* not json */ }
      if (peekBody && peekBody.action === "reprocess") {
        const filterRegistrationId: string | null = peekBody.registration_id || null;

        // 1) Resolve which sample_ids to reprocess
        let sampleIds: string[] = [];
        if (filterRegistrationId) {
          const { data: reg } = await supabase
            .from("patient_registrations")
            .select("invoice_number")
            .eq("id", filterRegistrationId)
            .maybeSingle();
          if (reg?.invoice_number) {
            // Match base invoice + suffixed tubes (e.g. 2604160004A)
            const { data: ords } = await supabase
              .from("lims_test_orders")
              .select("sample_id")
              .or(`sample_id.eq.${reg.invoice_number},sample_id.like.${reg.invoice_number}%`);
            sampleIds = Array.from(new Set((ords || []).map((o: any) => o.sample_id)));
          }
        } else {
          const { data: ords } = await supabase
            .from("lims_test_orders")
            .select("sample_id")
            .in("status", ["pending", "in_progress"]);
          sampleIds = Array.from(new Set((ords || []).map((o: any) => o.sample_id)));
        }

        let totalPushed = 0;
        let totalCompleted = 0;
        let processedOrders = 0;

        // Reprocess source: lims_interface_logs (the audit trail of every machine
        // submit_results call). We pull the original request_body and re-run the
        // bridge logic — same authoritative path as a live interface push.
        for (const sampleId of sampleIds) {
          const { data: logRows } = await supabase
            .from("lims_interface_logs")
            .select("request_body")
            .eq("sample_id", sampleId)
            .eq("event_type", "submit_results")
            .order("created_at", { ascending: false });

          // Collapse to the latest result per machine_code (most recent value wins)
          const latestByCode: Record<string, any> = {};
          for (const lr of logRows || []) {
            const reqBody: any = lr.request_body || {};
            const items: any[] = Array.isArray(reqBody.results) ? reqBody.results : [];
            for (const it of items) {
              const code = it.code || it.test_code || "";
              if (!code || latestByCode[code] !== undefined) continue;
              latestByCode[code] = it;
            }
          }
          const reprocessResults = Object.entries(latestByCode).map(([code, it]) => ({ ...it, code }));
          if (reprocessResults.length === 0) continue;

          // Resolve registration
          const invoiceNumber = sampleId.replace(/-[A-Za-z0-9]+$/, "");
          const { data: regRows } = await supabase
            .from("patient_registrations")
            .select("id, tests")
            .eq("invoice_number", invoiceNumber)
            .limit(1);
          const registration = regRows?.[0];
          if (!registration) continue;
          if (filterRegistrationId && registration.id !== filterRegistrationId) continue;

          processedOrders++;
          const registrationId = registration.id;
          const regTestIds = new Set(((registration.tests as any[]) || []).map((t: any) => t.test_id || t.id).filter(Boolean));

          // Re-map machine_codes → internal param/test codes
          const incomingCodes = reprocessResults.map((r: any) => r.code).filter(Boolean);
          let codeMap: Record<string, Array<{ mapped_param_code: string; mapped_test_code: string; parameter_name: string }>> = {};
          if (incomingCodes.length > 0) {
            const { data: mappings } = await supabase
              .from("lims_code_mapping").select("machine_code, mapped_param_code, mapped_test_code, parameter_name")
              .in("machine_code", incomingCodes);
            for (const m of mappings || []) {
              if (!codeMap[m.machine_code]) codeMap[m.machine_code] = [];
              codeMap[m.machine_code].push({
                mapped_param_code: m.mapped_param_code,
                mapped_test_code: m.mapped_test_code,
                parameter_name: m.parameter_name,
              });
            }
          }

          // Find this sample's order(s) for completion update + disambiguation
          const { data: orders } = await supabase
            .from("lims_test_orders")
            .select("id, tests")
            .eq("sample_id", sampleId);
          const orderTestCodes = new Set<string>();
          for (const ord of orders || []) {
            for (const t of (ord.tests as any[]) || []) {
              if (t?.code) orderTestCodes.add(t.code);
            }
          }

          // Build mapped result list
          const mappedItems: Array<{ test_code: string; result_value: string; unit: string }> = [];
          for (const r of reprocessResults) {
            const code = r.code || "";
            const candidates = codeMap[code] || [];
            const mapping = candidates.find((c) =>
              (c.mapped_param_code && orderTestCodes.has(c.mapped_param_code)) ||
              (c.mapped_test_code && orderTestCodes.has(c.mapped_test_code))
            ) || candidates[0];
            if (!mapping || !(mapping.mapped_param_code || mapping.mapped_test_code)) continue;
            mappedItems.push({
              test_code: mapping.mapped_param_code || mapping.mapped_test_code || code,
              result_value: String(r.value ?? r.result_value ?? ""),
              unit: r.unit || "",
            });
          }
          if (mappedItems.length === 0) continue;

          // Resolve params + test junction
          const paramCodes = Array.from(new Set(mappedItems.map((r) => r.test_code).filter(Boolean)));
          const { data: paramRows } = await supabase
            .from("report_test_parameters")
            .select("id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, unit_conversion_enabled, unit_conversion_operator, unit_conversion_value")
            .in("param_code", paramCodes);
          await attachUndefinedRangeFlag(supabase, paramRows || []);
          const paramByCode: Record<string, any> = {};
          for (const p of paramRows || []) paramByCode[p.param_code] = p;

          const paramIds = (paramRows || []).map((p) => p.id);
          let tpRows: any[] = [];
          if (paramIds.length > 0) {
            const { data } = await supabase
              .from("test_parameters")
              .select("test_id, parameter_id")
              .in("parameter_id", paramIds);
            tpRows = data || [];
          }
          const testIdsByParam: Record<string, string[]> = {};
          for (const tp of tpRows) {
            if (!testIdsByParam[tp.parameter_id]) testIdsByParam[tp.parameter_id] = [];
            testIdsByParam[tp.parameter_id].push(tp.test_id);
          }

          const { data: existingRows } = await supabase
            .from("patient_results")
            .select("id, parameter_id, status")
            .eq("registration_id", registrationId);
          const existingByParam: Record<string, any> = {};
          for (const er of existingRows || []) existingByParam[er.parameter_id] = er;

          const insertPayload: any[] = [];
          for (const sr of mappedItems) {
            const param = paramByCode[sr.test_code];
            if (!param) continue;
            const candidateTestIds = testIdsByParam[param.id] || [];
            const testId = candidateTestIds.find((tid) => regTestIds.has(tid)) || candidateTestIds[0];
            if (!testId) continue;

            const convertedValue = applyUnitConversion(sr.result_value, param, sr.unit);
            const flag = computeFlagFromInterface(convertedValue, param);

            const referenceRange = param.normal_range_text
              || (param.normal_range_low != null && param.normal_range_high != null
                  ? `${param.normal_range_low} - ${param.normal_range_high}`
                  : "");

            const existing = existingByParam[param.id];
            const nowIso = new Date().toISOString();
            if (existing) {
              if (existing.status && existing.status !== "pending") continue;
              const { error: updErr } = await supabase
                .from("patient_results")
                .update({
                  result_value: applyInterfaceUnitSuffix(convertedValue, param),
                  flag,
                  unit: param.unit || "",
                  reference_range: referenceRange,
                  normal_range_low: param.normal_range_low,
                  normal_range_high: param.normal_range_high,
                  is_from_interface: true,
                  entered_at: nowIso,
                  entered_by: "INTERFACE",
                  status: "pending",
                  updated_at: nowIso,
                })
                .eq("id", existing.id);
              if (!updErr) totalPushed++;
            } else {
              insertPayload.push({
                registration_id: registrationId,
                test_id: testId,
                parameter_id: param.id,
                param_code: param.param_code,
                parameter_name: param.parameter_name,
                result_value: applyInterfaceUnitSuffix(convertedValue, param),
                unit: param.unit || "",
                reference_range: referenceRange,
                normal_range_low: param.normal_range_low,
                normal_range_high: param.normal_range_high,
                flag,
                status: "pending",
                is_from_interface: true,
                entered_at: nowIso,
                entered_by: "INTERFACE",
              });
            }
          }

          if (insertPayload.length > 0) {
            const { error: insErr } = await supabase.from("patient_results").insert(insertPayload);
            if (!insErr) totalPushed += insertPayload.length;
          }

          // Auto-evaluate calculated parameters now that fresh values landed
          await autoCalcDependentParams(supabase, registrationId);

          // Re-evaluate order completion
          const completedCodes = new Set(mappedItems.map((m) => m.test_code));
          for (const ord of orders || []) {
            const tests = (ord.tests as any[]) || [];
            const updatedTests = tests.map((t: any) => ({
              ...t,
              status: completedCodes.has(t.code) ? "completed" : (t.status || "pending"),
            }));
            const allDone = updatedTests.length > 0 && updatedTests.every((t: any) => t.status === "completed");
            await supabase.from("lims_test_orders").update({
              tests: updatedTests,
              status: allDone ? "completed" : "in_progress",
            }).eq("id", ord.id);
            if (allDone) totalCompleted++;
          }
        }

        return new Response(JSON.stringify({
          success: true,
          processed: processedOrders,
          pushed: totalPushed,
          completed: totalCompleted,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // GET: Query tests for a sample_id, optionally filtered by machine_id
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      const sampleId = url.searchParams.get("sample_id");
      const machineId = url.searchParams.get("machine_id") || "";

      if (action !== "query" || !sampleId) {
        return new Response(
          JSON.stringify({ error: "Required: ?action=query&sample_id=XXX" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const requestBody = { action: "query", sample_id: sampleId, machine_id: machineId };

      // Exact match only — aggregate across tubes that share the same sample_id
      // (e.g. Plasma + Serum tubes both labeled "2604160004"). Never cross between
      // base ("2604160004") and suffixed ("2604160004A") IDs — they are distinct.
      const { data: orders, error: orderErr } = await supabase
        .from("lims_test_orders")
        .select("*")
        .eq("sample_id", sampleId)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: false });

      if (orderErr) throw orderErr;

      if (!orders || orders.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: "No pending orders found" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Merge pending tests across all matching tube orders
      const primaryOrder = orders[0];
      const pendingTests: any[] = [];
      for (const ord of orders) {
        const ts = (ord.tests as any[]) || [];
        for (const t of ts) {
          if (t.status !== "completed") pendingTests.push(t);
        }
        if (ord.status === "pending") {
          await supabase.from("lims_test_orders").update({ status: "in_progress" }).eq("id", ord.id);
        }
      }

      if (pendingTests.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: "All tests already completed" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Enrich tests with machine_id from tests/parameters tables
      const testCodes = pendingTests.map((t: any) => t.code).filter(Boolean);
      let machineMap: Record<string, string> = {};
      let reverseCodeMap: Record<string, string> = {};
      if (testCodes.length > 0) {
        const { data: testRows } = await supabase
          .from("tests").select("test_code, machine_id").in("test_code", testCodes);
        if (testRows) {
          for (const row of testRows) {
            if (row.test_code && row.machine_id) machineMap[row.test_code] = row.machine_id;
          }
        }
        const missingCodes = testCodes.filter((c: string) => !machineMap[c]);
        if (missingCodes.length > 0) {
          const { data: paramRows } = await supabase
            .from("report_test_parameters").select("param_code, machine_id").in("param_code", missingCodes);
          if (paramRows) {
            for (const row of paramRows) {
              if (row.param_code && row.machine_id) machineMap[row.param_code] = row.machine_id;
            }
          }
        }

        // Reverse-lookup: internal code (PRM####) -> machine_code (WBC, RBC, etc.)
        // machine_id is intentionally ignored — mappings apply to all machines.
        const { data: codeMappings } = await supabase
          .from("lims_code_mapping")
          .select("machine_code, mapped_param_code, mapped_test_code")
          .or(`mapped_param_code.in.(${testCodes.join(",")}),mapped_test_code.in.(${testCodes.join(",")})`);
        if (codeMappings) {
          for (const m of codeMappings) {
            if (m.machine_code && m.mapped_param_code && !reverseCodeMap[m.mapped_param_code]) {
              reverseCodeMap[m.mapped_param_code] = m.machine_code;
            }
            if (m.machine_code && m.mapped_test_code && !reverseCodeMap[m.mapped_test_code]) {
              reverseCodeMap[m.mapped_test_code] = m.machine_code;
            }
          }
        }
      }

      // Build enriched test list — only include tests with a configured machine_code mapping
      // AND a non-empty resolved machine_id (skip parameters with no assigned machine).
      const enrichedTests = pendingTests
        .filter((t: any) => reverseCodeMap[t.code])
        .map((t: any) => {
          const resolvedMachineId = t.machine_id || machineMap[t.code] || "";
          return {
            code: reverseCodeMap[t.code],
            name: t.name,
            unit: t.unit || "",
            machine_id: resolvedMachineId,
          };
        })
        .filter((t: any) => t.machine_id !== "");

      // Filter by requesting machine_id (case-insensitive).
      // Tests with no machine_id assigned are treated as universal (returned to any machine).
      const filteredTests = machineId
        ? enrichedTests.filter((t) =>
            !t.machine_id ||
            t.machine_id.toLowerCase() === machineId.toLowerCase()
          )
        : enrichedTests;

      if (filteredTests.length === 0) {
        const responseBody = { sample_id: sampleId, tests: [], message: machineId ? `No pending tests for machine ${machineId}` : "No pending tests" };
        await supabase.from("lims_interface_logs").insert({
          sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
          request_body: requestBody, response_body: responseBody, machine_id: machineId,
        });
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const responseBody = {
        order_id: primaryOrder.id,
        sample_id: sampleId,
        patient_name: primaryOrder.patient_name,
        tests: filteredTests,
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id: sampleId, direction: "outgoing", event_type: "query_tests",
        request_body: requestBody, response_body: responseBody, machine_id: machineId,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST: Submit results with code mapping
    if (req.method === "POST") {
      const body = await req.json();
      const { action, sample_id, order_id, results, machine_id: bodyMachineId } = body;

      if (action !== "results" || !sample_id || !Array.isArray(results)) {
        return new Response(
          JSON.stringify({ error: "Required: {action:'results', sample_id, results:[...]}" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const machineId = bodyMachineId || "";

      // Find matching order
      let orderId = order_id;
      if (!orderId) {
        const { data: orders } = await supabase
          .from("lims_test_orders").select("id")
          .eq("sample_id", sample_id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false }).limit(1);
        orderId = orders?.[0]?.id || null;
      }

      // Fetch all code mappings for the incoming codes (1 machine_code → N internal codes allowed)
      const incomingCodes = results.map((r: any) => r.code || r.test_code || "").filter(Boolean);
      let codeMap: Record<string, Array<{ mapped_param_code: string; mapped_test_code: string; parameter_name: string }>> = {};
      if (incomingCodes.length > 0) {
        const { data: mappings } = await supabase
          .from("lims_code_mapping").select("machine_code, mapped_param_code, mapped_test_code, parameter_name")
          .in("machine_code", incomingCodes);
        if (mappings) {
          for (const m of mappings) {
            if (!codeMap[m.machine_code]) codeMap[m.machine_code] = [];
            codeMap[m.machine_code].push({
              mapped_param_code: m.mapped_param_code,
              mapped_test_code: m.mapped_test_code,
              parameter_name: m.parameter_name,
            });
          }
        }
      }

      // Fetch the order's pending test codes so we can disambiguate when one
      // machine_code maps to multiple internal codes (e.g. GLU → fasting vs random).
      let orderTestCodes = new Set<string>();
      if (orderId) {
        const { data: ord } = await supabase
          .from("lims_test_orders").select("tests").eq("id", orderId).single();
        if (ord) {
          for (const t of ((ord.tests as any[]) || [])) {
            if (t?.code) orderTestCodes.add(t.code);
          }
        }
      }

      const mappedRows: any[] = [];
      const unmappedRows: any[] = [];

      for (const r of results) {
        const code = r.code || r.test_code || "";
        const candidates = codeMap[code] || [];
        // Pick the mapping whose internal code is present in this order;
        // otherwise fall back to the first mapping.
        const mapping = candidates.find((c) =>
          (c.mapped_param_code && orderTestCodes.has(c.mapped_param_code)) ||
          (c.mapped_test_code && orderTestCodes.has(c.mapped_test_code))
        ) || candidates[0];

        if (mapping && (mapping.mapped_param_code || mapping.mapped_test_code)) {
          // Mapped result — insert into lims_test_results with mapped code
          mappedRows.push({
            order_id: orderId,
            sample_id,
            test_code: mapping.mapped_param_code || mapping.mapped_test_code || code,
            test_name: mapping.parameter_name || r.name || r.test_name || "",
            result_value: String(r.value ?? r.result_value ?? ""),
            unit: r.unit || "",
            reference_range: r.reference_range || r.normal_range || "",
            flag: r.flag || "Normal",
          });
        } else {
          // Unmapped result — store for manual mapping
          unmappedRows.push({
            sample_id,
            order_id: orderId,
            machine_code: code,
            machine_id: machineId,
            result_value: String(r.value ?? r.result_value ?? ""),
            unit: r.unit || "",
            reference_range: r.reference_range || r.normal_range || "",
            flag: r.flag || "Normal",
          });
        }
      }

      // NOTE: lims_test_results table was dropped (cost optimization 2026-04).
      // Mapped results are bridged DIRECTLY into patient_results below; we no
      // longer mirror them into a separate intermediate table. The reprocess
      // path reads from lims_interface_logs.request_body for re-bridging.


      // Filter out unmapped rows whose machine_code is on the No Map Required ignore list
      let ignoredCount = 0;
      let finalUnmappedRows = unmappedRows;
      if (unmappedRows.length > 0) {
        const unmappedCodes = Array.from(new Set(unmappedRows.map((r) => r.machine_code).filter(Boolean)));
        if (unmappedCodes.length > 0) {
          const { data: ignoreList } = await supabase
            .from("lims_no_map_required")
            .select("machine_code")
            .in("machine_code", unmappedCodes);
          const ignoreSet = new Set((ignoreList || []).map((i: any) => i.machine_code));
          if (ignoreSet.size > 0) {
            finalUnmappedRows = unmappedRows.filter((r) => !ignoreSet.has(r.machine_code));
            ignoredCount = unmappedRows.length - finalUnmappedRows.length;
          }
        }
      }

      // Insert unmapped results (after ignore-list filter)
      if (finalUnmappedRows.length > 0) {
        const { error: unmappedErr } = await supabase.from("lims_unmapped_results").insert(finalUnmappedRows);
        if (unmappedErr) throw unmappedErr;
      }

      // ===== Bridge mapped results into patient_results (Results Entry UI) =====
      let patientResultsWritten = 0;
      let registrationResolved = false;
      try {
        // 1) Resolve registration_id from sample_id (strip trailing letter suffix)
        const invoiceNumber = sample_id.replace(/-[A-Za-z0-9]+$/, "");
        const { data: regRows } = await supabase
          .from("patient_registrations")
          .select("id, tests")
          .eq("invoice_number", invoiceNumber)
          .limit(1);
        const registration = regRows?.[0];

        if (registration && mappedRows.length > 0) {
          registrationResolved = true;
          const registrationId = registration.id;
          const regTestIds = new Set(((registration.tests as any[]) || []).map((t: any) => t.test_id || t.id).filter(Boolean));

          // 2) Resolve parameters by param_code
          const paramCodes = Array.from(new Set(mappedRows.map((r) => r.test_code).filter(Boolean)));
          const { data: paramRows } = await supabase
            .from("report_test_parameters")
            .select("id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, unit_conversion_enabled, unit_conversion_operator, unit_conversion_value")
            .in("param_code", paramCodes);
          await attachUndefinedRangeFlag(supabase, paramRows || []);
          const paramByCode: Record<string, any> = {};
          for (const p of paramRows || []) paramByCode[p.param_code] = p;

          // Resolve test_id via test_parameters junction; prefer tests present in registration
          const paramIds = (paramRows || []).map((p) => p.id);
          let tpRows: any[] = [];
          if (paramIds.length > 0) {
            const { data } = await supabase
              .from("test_parameters")
              .select("test_id, parameter_id")
              .in("parameter_id", paramIds);
            tpRows = data || [];
          }
          const testIdsByParam: Record<string, string[]> = {};
          for (const tp of tpRows) {
            if (!testIdsByParam[tp.parameter_id]) testIdsByParam[tp.parameter_id] = [];
            testIdsByParam[tp.parameter_id].push(tp.test_id);
          }

          // 3) Fetch existing patient_results for this registration to decide insert vs update vs skip
          const { data: existingRows } = await supabase
            .from("patient_results")
            .select("id, parameter_id, status, result_value")
            .eq("registration_id", registrationId);
          const existingByParam: Record<string, any> = {};
          for (const er of existingRows || []) existingByParam[er.parameter_id] = er;

          const insertPayload: any[] = [];
          for (const mr of mappedRows) {
            const param = paramByCode[mr.test_code];
            if (!param) continue;
            const candidateTestIds = testIdsByParam[param.id] || [];
            const testId = candidateTestIds.find((tid) => regTestIds.has(tid)) || candidateTestIds[0];
            if (!testId) continue;

            // Compute flag (numeric → H/L/N; qualitative/descriptive → N or X)
            const convertedValue = applyUnitConversion(mr.result_value, param, mr.unit);
            const flag = computeFlagFromInterface(convertedValue, param);

            const referenceRange = param.normal_range_text
              || (param.normal_range_low != null && param.normal_range_high != null
                  ? `${param.normal_range_low} - ${param.normal_range_high}`
                  : "");

            const existing = existingByParam[param.id];
            const nowIso = new Date().toISOString();
            if (existing) {
              // Skip if technician/verifier/approver already worked on it
              if (existing.status && existing.status !== "pending") continue;
              const { error: updErr } = await supabase
                .from("patient_results")
                .update({
                  result_value: applyInterfaceUnitSuffix(convertedValue, param),
                  flag,
                  unit: param.unit || "",
                  reference_range: referenceRange,
                  normal_range_low: param.normal_range_low,
                  normal_range_high: param.normal_range_high,
                  is_from_interface: true,
                  entered_at: nowIso,
                  entered_by: "INTERFACE",
                  status: "pending",
                  updated_at: nowIso,
                })
                .eq("id", existing.id);
              if (!updErr) patientResultsWritten++;
            } else {
              insertPayload.push({
                registration_id: registrationId,
                test_id: testId,
                parameter_id: param.id,
                param_code: param.param_code,
                parameter_name: param.parameter_name,
                result_value: applyInterfaceUnitSuffix(convertedValue, param),
                unit: param.unit || "",
                reference_range: referenceRange,
                normal_range_low: param.normal_range_low,
                normal_range_high: param.normal_range_high,
                flag,
                status: "pending",
                is_from_interface: true,
                entered_at: nowIso,
                entered_by: "INTERFACE",
              });
            }
          }

          if (insertPayload.length > 0) {
            const { error: insErr } = await supabase.from("patient_results").insert(insertPayload);
            if (!insErr) patientResultsWritten += insertPayload.length;
            else console.error("patient_results insert error:", insErr);
          }

          // Auto-evaluate calculated parameters now that fresh values landed
          const calcWritten = await autoCalcDependentParams(supabase, registrationId);
          patientResultsWritten += calcWritten;
        }
      } catch (bridgeErr) {
        console.error("patient_results bridge error:", bridgeErr);
      }

      // Update order: mark individual tests as completed for mapped results
      if (orderId && mappedRows.length > 0) {
        const { data: order } = await supabase
          .from("lims_test_orders").select("tests").eq("id", orderId).single();

        if (order) {
          const tests = (order.tests as any[]) || [];
          const mappedCodes = new Set(mappedRows.map((r) => r.test_code));
          // Also match by original incoming code for direct matches
          const originalCodes = new Set(results.filter((r: any) => {
            const code = r.code || r.test_code || "";
            const first = codeMap[code]?.[0];
            return first && (first.mapped_param_code || first.mapped_test_code);
          }).map((r: any) => r.code || r.test_code || ""));

          const updatedTests = tests.map((t: any) => ({
            ...t,
            status: (mappedCodes.has(t.code) || originalCodes.has(t.code)) ? "completed" : (t.status || "pending"),
          }));

          const allDone = updatedTests.every((t: any) => t.status === "completed");
          await supabase.from("lims_test_orders").update({
            tests: updatedTests,
            status: allDone ? "completed" : "in_progress",
          }).eq("id", orderId);
        }
      }

      const responseBody = {
        success: true,
        sample_id,
        results_received: results.length,
        mapped: mappedRows.length,
        unmapped: finalUnmappedRows.length,
        ignored: ignoredCount,
        order_id: orderId,
        registration_resolved: registrationResolved,
        patient_results_written: patientResultsWritten,
      };

      await supabase.from("lims_interface_logs").insert({
        sample_id, direction: "incoming", event_type: "submit_results",
        request_body: body, response_body: responseBody, machine_id: machineId,
      });

      return new Response(JSON.stringify(responseBody), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("lims-interface error:", err);
    return new Response(
      JSON.stringify({ error: true, message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
