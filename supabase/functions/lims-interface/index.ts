import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import {
  machineIdAliases,
  normalizeInterfaceResultCode,
  orderTestsMatchMachine,
} from "./interfaceResultCode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // x-ph-access-token: staff JWT from LIMS browser client (Pull from LIMS / reprocess)
  // x-lims-interface-secret: optional middleware ingest auth
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ph-access-token, x-lims-interface-secret",
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

/** Tiny Realtime notify so open LIMS tabs refresh without publishing patient_results. */
async function notifyResultUpdate(supabase: any, registrationId: string, source = "interface") {
  if (!registrationId) return;
  try {
    await supabase.from("lims_result_notify").insert({
      registration_id: registrationId,
      source,
    });
  } catch (e) {
    console.error("lims_result_notify insert failed:", e);
  }
}

function b64urlDecode(str: string): Uint8Array {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function resolveJwtSecret(): string {
  let secretRaw =
    Deno.env.get("JWT_SECRET") ||
    Deno.env.get("SUPABASE_JWT_SECRET") ||
    Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ||
    "";
  if (!secretRaw) {
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const isLocalDemo =
      svc.includes('"iss":"supabase-demo"') ||
      svc.includes("supabase-demo") ||
      svc.startsWith("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1v") ||
      /127\.0\.0\.1|localhost/i.test(url);
    if (isLocalDemo) {
      secretRaw = "super-secret-jwt-token-with-at-least-32-characters-long";
    }
  }
  return secretRaw;
}

function extractStaffToken(req: Request): string | null {
  // Preferred: custom staff JWT header (PostgREST Authorization stays as anon key).
  const ph = req.headers.get("x-ph-access-token")?.trim();
  if (ph && ph.split(".").length === 3) return ph;
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const bearer = m[1].trim();
  // Ignore anon/publishable API keys — only treat JWT-shaped values as staff tokens.
  if (bearer.split(".").length === 3) return bearer;
  return null;
}

async function verifyStaffJwt(req: Request): Promise<boolean> {
  const token = extractStaffToken(req);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const secretRaw = resolveJwtSecret();
  if (!secretRaw) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretRaw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = b64urlDecode(parts[2]);
  const ok = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
  if (!ok) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.app_role && payload.app_role !== "staff") return false;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
    return !!payload.sub;
  } catch {
    return false;
  }
}

/** Pick the pending order for this sample that belongs to the posting analyzer. */
function resolveOrderForMachine(
  orders: Array<{ id: string; tests?: any[] }> | null | undefined,
  machineId: string,
): string | null {
  if (!orders || orders.length === 0) return null;
  const matched = orders.find((ord) => orderTestsMatchMachine(ord.tests || [], machineId));
  return (matched || orders[0]).id;
}

const XP_HIST_SCALE: Record<string, { x_min: number; x_max: number; x_label: string }> = {
  WBC: { x_min: 30, x_max: 300, x_label: "Volume (fL)" },
  RBC: { x_min: 30, x_max: 300, x_label: "Volume (fL)" },
  PLT: { x_min: 2, x_max: 30, x_label: "Volume (fL)" },
};

async function storeAnalyzerHistograms(
  supabase: any,
  sampleId: string,
  machineId: string,
  format: string,
  histograms: any[],
): Promise<{ received: number; stored: number }> {
  const received = Array.isArray(histograms) ? histograms.length : 0;
  if (received === 0) return { received: 0, stored: 0 };

  const invoiceNumber = sampleId.replace(/-[A-Za-z0-9]+$/, "");
  const { data: regRows } = await supabase
    .from("patient_registrations")
    .select("id")
    .eq("invoice_number", invoiceNumber)
    .limit(1);
  const registrationId = regRows?.[0]?.id || null;

  let testId: string | null = null;
  if (registrationId) {
    const { data: tubes } = await supabase
      .from("sample_tubes")
      .select("test_ids, test_names")
      .eq("registration_id", registrationId);
    for (const tube of tubes || []) {
      const names = Array.isArray(tube.test_names) ? tube.test_names : [];
      if (names.some((n: string) => /cbc|complete blood/i.test(String(n || "")))) {
        const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
        testId = ids[0] || null;
        break;
      }
    }
  }

  let stored = 0;
  for (const h of histograms) {
    const kind = String(h?.kind || "").trim().toUpperCase();
    const bins = Array.isArray(h?.bins)
      ? h.bins.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n))
      : [];
    if (!kind || bins.length < 10) continue;
    const scale = XP_HIST_SCALE[kind] || {};
    const row = {
      registration_id: registrationId,
      sample_id: sampleId,
      test_id: testId,
      kind,
      bins,
      discriminators: Array.isArray(h.discriminators) ? h.discriminators : null,
      x_min: h.x_min ?? scale.x_min ?? null,
      x_max: h.x_max ?? scale.x_max ?? null,
      x_label: h.x_label ?? scale.x_label ?? null,
      bin_count: bins.length,
      source: h.source || null,
      format: format || h.format || null,
      machine_id: machineId || "",
      estimated: !!h.estimated,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await supabase
      .from("analyzer_histograms")
      .select("id")
      .eq("sample_id", sampleId)
      .eq("kind", kind)
      .limit(1);
    const existingId = existing?.[0]?.id;
    if (existingId) {
      const { error } = await supabase.from("analyzer_histograms").update(row).eq("id", existingId);
      if (!error) stored++;
    } else {
      const { error } = await supabase.from("analyzer_histograms").insert(row);
      if (!error) stored++;
    }
  }
  return { received, stored };
}

function checkIngestSecret(req: Request): boolean {
  const expected = Deno.env.get("LIMS_INTERFACE_SECRET") || "";
  // If not configured, allow (local/dev); when set, require header or query match.
  if (!expected) return true;
  const header = req.headers.get("x-lims-interface-secret") || "";
  const url = new URL(req.url);
  const q = url.searchParams.get("secret") || "";
  return header === expected || q === expected;
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
// - Numeric value with numeric bounds → H/L/N (incl. operator-prefixed vs low/high)
// - Descriptive: prefer _normalFindings (from parameter_normal_ranges) → N/X
// - Otherwise (qualitative), compare against normal_range_text → N/X
function computeFlagFromInterface(rawValue: string, param: any): string {
  const value = (rawValue ?? "").toString().trim();
  if (!value) return "";
  if (param?._isUndefinedRange || param?._rangeType === "undefined") return "";

  const lowRaw = param?.normal_range_low;
  const highRaw = param?.normal_range_high;
  const low = lowRaw != null && lowRaw !== "" && !isNaN(Number(lowRaw)) ? Number(lowRaw) : null;
  const high = highRaw != null && highRaw !== "" && !isNaN(Number(highRaw)) ? Number(highRaw) : null;

  const gtMatch = value.match(/^(?:>=|≥|>)\s*(-?\d*\.?\d+)/);
  if (gtMatch) {
    const num = parseFloat(gtMatch[1]);
    if (!isNaN(num)) {
      if (high != null && num >= high) return "H";
      if (low != null && num >= low && (high == null || num <= high)) return "N";
      return "H";
    }
  }
  const ltMatch = value.match(/^(?:<=|≤|<)\s*(-?\d*\.?\d+)/);
  if (ltMatch) {
    const num = parseFloat(ltMatch[1]);
    if (!isNaN(num)) {
      if (high != null && num <= high) return "N";
      if (low != null && num <= low) return "L";
      if (high != null && num > high) return "H";
      return "L";
    }
  }

  const num = parseFloat(value);
  if (!isNaN(num) && (low != null || high != null)) {
    if (low != null && num < low) return "L";
    if (high != null && num > high) return "H";
    return "N";
  }

  const rangeType = (param?._rangeType || "numeric") as string;
  if (rangeType === "descriptive") {
    const findingsRaw = (param?._normalFindings ?? "").toString();
    const parts = findingsRaw
      .split(/\r?\n|\|/)
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return "";
    const got = value.toLowerCase();
    return parts.some((f: string) => f === got) ? "N" : "X";
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

// Attach range metadata from parameter_normal_ranges for interface flagging:
// _isUndefinedRange, _rangeType, _normalFindings, and fill empty text/low/high.
// Optional patientGender/dob picks the age/gender row (same rules as Results UI).
async function attachRangeMeta(
  supabase: any,
  paramRows: any[],
  patient?: { gender?: string | null; dob?: string | null } | null,
) {
  const ids = (paramRows || []).map((p) => p.id);
  if (ids.length === 0) return;
  const { data: rangeRows } = await supabase
    .from("parameter_normal_ranges")
    .select("parameter_id, gender, age_min, age_max, range_type, normal_findings, normal_range_text, normal_range_low, normal_range_high")
    .in("parameter_id", ids);
  const byParam: Record<string, any[]> = {};
  for (const r of rangeRows || []) {
    const pid = r.parameter_id as string;
    if (!byParam[pid]) byParam[pid] = [];
    byParam[pid].push(r);
  }
  const patientGender = String(patient?.gender || "").toLowerCase().charAt(0);
  let patientAge: number | null = null;
  if (patient?.dob) {
    const birth = new Date(patient.dob);
    if (!Number.isNaN(birth.getTime())) {
      patientAge = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }
  for (const p of paramRows) {
    const rows = byParam[p.id] || [];
    const types = rows.map((r) => (r.range_type || "numeric") as string);
    p._isUndefinedRange = types.length > 0 && types.every((t) => t === "undefined");

    let candidates = rows.filter((r) => {
      const g = String(r.gender || "all").toLowerCase();
      return g === "all" || (g === "male" && patientGender === "m") || (g === "female" && patientGender === "f");
    });
    if (patientAge != null) {
      const ageMatched = candidates.filter((r) => {
        if (r.age_min == null && r.age_max == null) return true;
        if (r.age_min != null && patientAge! < r.age_min) return false;
        if (r.age_max != null && patientAge! > r.age_max) return false;
        return true;
      });
      if (ageMatched.length > 0) candidates = ageMatched;
    }
    const best = candidates.find((r) => String(r.gender || "all").toLowerCase() !== "all") || candidates[0] || rows[0];
    p._rangeType = best?.range_type || "numeric";
    p._normalFindings = best?.normal_findings || "";
    if (!String(p.normal_range_text || "").trim() && best?.normal_range_text) {
      p.normal_range_text = best.normal_range_text;
    }
    if ((p.normal_range_low == null || p.normal_range_low === "") && best?.normal_range_low != null) {
      p.normal_range_low = best.normal_range_low;
    }
    if ((p.normal_range_high == null || p.normal_range_high === "") && best?.normal_range_high != null) {
      p.normal_range_high = best.normal_range_high;
    }
    // One-sided numeric ranges: still produce reportable reference text
    if (!String(p.normal_range_text || "").trim()) {
      const low = p.normal_range_low;
      const high = p.normal_range_high;
      const u = String(p.unit || "").trim();
      const suffix = u ? ` ${u}` : "";
      if (low != null && high != null) p.normal_range_text = `${low} - ${high}${suffix}`;
      else if (high != null && low == null) p.normal_range_text = `< ${high}${suffix}`;
      else if (low != null && high == null) p.normal_range_text = `> ${low}${suffix}`;
    }
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
      const p = unwrapEmbeddedRow(tp.report_test_parameters);
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

async function loadAcceptedTestIds(supabase: any, registrationId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: tubes } = await supabase
    .from("sample_tubes")
    .select("test_ids, status")
    .eq("registration_id", registrationId)
    .eq("status", "accepted");
  for (const tube of tubes || []) {
    for (const id of (Array.isArray(tube.test_ids) ? tube.test_ids : [])) {
      if (id) ids.add(String(id));
    }
  }
  return ids;
}

/**
 * Interface writes are allowed ONLY onto accepted-tube leaf tests that own the
 * parameter. No fallback to registration container / unbooked tests (e.g. PCOD).
 *
 * If several accepted tests share the same parameter, ALL of them are returned
 * so the same analyzer value is written to each.
 */
function resolveAcceptedBridgeTestIds(
  candidateTestIds: string[],
  acceptedTestIds: Set<string>,
): string[] {
  if (!candidateTestIds.length || acceptedTestIds.size === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tid of candidateTestIds) {
    if (!tid || !acceptedTestIds.has(tid) || seen.has(tid)) continue;
    seen.add(tid);
    out.push(tid);
  }
  return out;
}

/** Delete pending rows for a parameter whose test_id is outside the keep set. */
async function deletePendingOutsideKeepTests(
  supabase: any,
  registrationId: string,
  keepTestsByParam: Record<string, string[]>,
): Promise<void> {
  for (const [paramId, keepIds] of Object.entries(keepTestsByParam)) {
    if (!keepIds.length) continue;
    const keep = new Set(keepIds);
    const { data: pending } = await supabase
      .from("patient_results")
      .select("id, test_id")
      .eq("registration_id", registrationId)
      .eq("parameter_id", paramId)
      .eq("status", "pending");
    const toDelete = (pending || [])
      .filter((r: any) => r.test_id && !keep.has(r.test_id))
      .map((r: any) => r.id);
    if (toDelete.length === 0) continue;
    await supabase.from("patient_results").delete().in("id", toDelete);
  }
}

/** Unwrap PostgREST many-to-one embed (object or single-element array). */
function unwrapEmbeddedRow<T extends { id?: string }>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] || null;
  return raw;
}

/**
 * Auto "Save & Verify" once all interfaced values for a test have arrived.
 *
 * Completeness rule (per user):
 *   - Require non-empty values for parameters that are send_for_interface,
 *     not calculated, AND have at least one lims_code_mapping row — i.e. the
 *     analyzer can actually deliver them.
 *   - send_for_interface params with NO mapping (e.g. CBC Basophils / Eos /
 *     Monocytes on a 3-part differential that only sends MXD%) are treated as
 *     manual: they do not block promotion; blank stubs go to Verification.
 *   - Calculated params are also ignored for the gate and stubbed.
 *
 * Stamp: entered_by = "Administrator" (shown on Dispatch "Results Entered").
 */
async function autoEnterCompleteInterfaceTests(
  supabase: any,
  registrationId: string,
): Promise<number> {
  if (!registrationId) return 0;
  let promotedTests = 0;
  try {
    const acceptedTestIds = await loadAcceptedTestIds(supabase, registrationId);
    if (acceptedTestIds.size === 0) return 0;

    const { data: snips } = await supabase
      .from("outsourced_test_snips")
      .select("test_id")
      .eq("registration_id", registrationId);
    const outsourcedTestIds = new Set(
      (snips || []).map((s: any) => s.test_id).filter(Boolean),
    );

    const { data: resultRows } = await supabase
      .from("patient_results")
      .select("id, test_id, parameter_id, param_code, parameter_name, result_value, status, is_from_interface, unit, reference_range, normal_range_low, normal_range_high, flag, is_calculated")
      .eq("registration_id", registrationId);
    const results = (resultRows || []) as any[];
    if (results.length === 0) return 0;

    const resultsByTest: Record<string, any[]> = {};
    for (const r of results) {
      if (!r.test_id || !acceptedTestIds.has(r.test_id)) continue;
      if (outsourcedTestIds.has(r.test_id)) continue;
      if (!resultsByTest[r.test_id]) resultsByTest[r.test_id] = [];
      resultsByTest[r.test_id].push(r);
    }

    const candidateTestIds = Object.keys(resultsByTest).filter((tid) =>
      resultsByTest[tid].some((r) => r.is_from_interface),
    );
    if (candidateTestIds.length === 0) return 0;

    const { data: tpRows } = await supabase
      .from("test_parameters")
      .select("test_id, parameter_id, is_subheader, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, send_for_interface)")
      .in("test_id", candidateTestIds);

    type ParamMeta = {
      id: string;
      param_code: string;
      parameter_name: string;
      unit: string;
      normal_range_low: number | null;
      normal_range_high: number | null;
      normal_range_text: string | null;
      is_calculated: boolean;
      send_for_interface: boolean;
    };
    const allParamsByTest: Record<string, ParamMeta[]> = {};
    const candidateIfaceParams: ParamMeta[] = [];
    for (const tp of (tpRows || []) as any[]) {
      if (tp.is_subheader) continue;
      const p = unwrapEmbeddedRow(tp.report_test_parameters);
      if (!p?.id) continue;
      if (!allParamsByTest[tp.test_id]) allParamsByTest[tp.test_id] = [];
      allParamsByTest[tp.test_id].push(p);
      if (p.send_for_interface && !p.is_calculated) candidateIfaceParams.push(p);
    }

    // Only params that analyzers can deliver (have a code mapping) block auto-enter.
    const mappedParamCodes = new Set<string>();
    const ifaceCodes = Array.from(
      new Set(candidateIfaceParams.map((p) => p.param_code).filter(Boolean)),
    );
    if (ifaceCodes.length > 0) {
      const [{ data: byParam }, { data: byTest }] = await Promise.all([
        supabase.from("lims_code_mapping").select("mapped_param_code").in("mapped_param_code", ifaceCodes),
        supabase.from("lims_code_mapping").select("mapped_test_code").in("mapped_test_code", ifaceCodes),
      ]);
      for (const m of byParam || []) {
        if (m.mapped_param_code) mappedParamCodes.add(m.mapped_param_code);
      }
      for (const m of byTest || []) {
        if (m.mapped_test_code) mappedParamCodes.add(m.mapped_test_code);
      }
    }

    const interfaceParamIdsByTest: Record<string, string[]> = {};
    for (const [testId, params] of Object.entries(allParamsByTest)) {
      for (const p of params) {
        if (!p.send_for_interface || p.is_calculated) continue;
        // Unmapped "interface" flags are manual in practice — do not gate on them.
        if (!p.param_code || !mappedParamCodes.has(p.param_code)) continue;
        if (!interfaceParamIdsByTest[testId]) interfaceParamIdsByTest[testId] = [];
        interfaceParamIdsByTest[testId].push(p.id);
      }
    }

    const nowIso = new Date().toISOString();
    const PAST_ENTRY = new Set(["verified", "approved", "dispatched"]);
    const ENTERED_BY = "Administrator";

    for (const testId of candidateTestIds) {
      const interfaceParamIds = interfaceParamIdsByTest[testId] || [];
      // No deliverable interfaced params → never auto-promote this test
      if (interfaceParamIds.length === 0) continue;

      const rows = resultsByTest[testId] || [];
      const byParam: Record<string, any> = {};
      for (const r of rows) byParam[r.parameter_id] = r;

      let complete = true;
      let anyPending = false;
      for (const pid of interfaceParamIds) {
        const row = byParam[pid];
        if (!row || row.result_value == null || String(row.result_value).trim() === "") {
          complete = false;
          break;
        }
        if (PAST_ENTRY.has(row.status)) {
          complete = false;
          break;
        }
        if (!row.status || row.status === "pending") anyPending = true;
      }
      if (!complete || !anyPending) continue;

      // Promote every existing pending row on this test (interface + any calc already written)
      const pendingIds = rows
        .filter((r) => !r.status || r.status === "pending")
        .map((r) => r.id);

      if (pendingIds.length > 0) {
        const { error } = await supabase
          .from("patient_results")
          .update({
            status: "entered",
            entered_at: nowIso,
            entered_by: ENTERED_BY,
            updated_at: nowIso,
          })
          .in("id", pendingIds)
          .eq("status", "pending");
        if (error) {
          console.error("autoEnterCompleteInterfaceTests update error:", error);
          continue;
        }
      }

      // Stub blank entered rows for calculated + manual params so the WHOLE test
      // leaves Results and appears in Verification for the technician to finish.
      const stubInserts: any[] = [];
      for (const p of (allParamsByTest[testId] || [])) {
        if (byParam[p.id]) continue; // already have a row (now entered)
        const refRange = p.normal_range_text
          || (p.normal_range_low != null && p.normal_range_high != null
              ? `${p.normal_range_low} - ${p.normal_range_high}`
              : "");
        stubInserts.push({
          registration_id: registrationId,
          test_id: testId,
          parameter_id: p.id,
          param_code: p.param_code || null,
          parameter_name: p.parameter_name || null,
          result_value: null,
          unit: p.unit || "",
          reference_range: refRange,
          normal_range_low: p.normal_range_low,
          normal_range_high: p.normal_range_high,
          flag: null,
          status: "entered",
          is_calculated: !!p.is_calculated,
          is_from_interface: false,
          entered_at: nowIso,
          entered_by: ENTERED_BY,
        });
      }
      if (stubInserts.length > 0) {
        const { error: stubErr } = await supabase.from("patient_results").insert(stubInserts);
        if (stubErr) {
          console.error("autoEnterCompleteInterfaceTests stub insert error:", stubErr);
          // Still count as promoted — interface rows are entered; stubs are best-effort
        }
      }

      promotedTests++;
    }

    if (promotedTests > 0) {
      await bumpRegistrationStatusAfterInterfaceEnter(supabase, registrationId, acceptedTestIds);
    }
  } catch (err) {
    console.error("autoEnterCompleteInterfaceTests error:", err);
  }
  return promotedTests;
}

/**
 * Move pending results written under non-accepted-tube test_ids onto the
 * accepted-tube test that owns the parameter (e.g. PCOD TSH → TFT).
 */
async function healOrphanResultsForRegistration(
  supabase: any,
  registrationId: string,
): Promise<number> {
  try {
    const acceptedTestIds = await loadAcceptedTestIds(supabase, registrationId);
    if (acceptedTestIds.size === 0) return 0;

    const { data: existingRows } = await supabase
      .from("patient_results")
      .select("*")
      .eq("registration_id", registrationId);
    const rows = (existingRows || []) as any[];
    const orphans = rows.filter(
      (r) => r.test_id && !acceptedTestIds.has(r.test_id) && (!r.status || r.status === "pending"),
    );
    if (orphans.length === 0) return 0;

    const paramIds = Array.from(new Set(orphans.map((r) => r.parameter_id).filter(Boolean)));
    const { data: tpRows } = await supabase
      .from("test_parameters")
      .select("test_id, parameter_id")
      .in("parameter_id", paramIds);

    const targetsByParam: Record<string, string[]> = {};
    for (const tp of tpRows || []) {
      if (!acceptedTestIds.has(tp.test_id)) continue;
      if (!targetsByParam[tp.parameter_id]) targetsByParam[tp.parameter_id] = [];
      targetsByParam[tp.parameter_id].push(tp.test_id);
    }

    const pickTarget = (parameterId: string): string | null => {
      const candidates = targetsByParam[parameterId] || [];
      if (!candidates.length) return null;
      if (candidates.length === 1) return candidates[0];
      const scored = candidates.map((tid) => ({
        tid,
        past: rows.filter((r) => r.test_id === tid && ["entered", "results_entered", "verified", "approved", "dispatched"].includes(r.status)).length,
        count: rows.filter((r) => r.test_id === tid).length,
      }));
      scored.sort((a, b) => b.past - a.past || b.count - a.count);
      return scored[0].tid;
    };

    let healed = 0;
    for (const orphan of orphans) {
      const targetTestId = pickTarget(orphan.parameter_id);
      if (!targetTestId) {
        if (orphan.result_value == null || String(orphan.result_value).trim() === "") {
          await supabase.from("patient_results").delete().eq("id", orphan.id);
        }
        continue;
      }
      const target = rows.find(
        (r) => r.test_id === targetTestId && r.parameter_id === orphan.parameter_id,
      );
      if (target && ["entered", "results_entered", "verified", "approved", "dispatched"].includes(target.status)) {
        await supabase.from("patient_results").delete().eq("id", orphan.id);
        continue;
      }

      const orphanHasVal = orphan.result_value != null && String(orphan.result_value).trim() !== "";
      const targetHasDownstream = rows.some(
        (r) =>
          r.test_id === targetTestId &&
          ["entered", "results_entered", "verified", "approved", "dispatched"].includes(r.status),
      );
      const payload: any = {
        result_value: orphan.result_value,
        flag: orphan.flag,
        unit: orphan.unit,
        reference_range: orphan.reference_range,
        normal_range_low: orphan.normal_range_low,
        normal_range_high: orphan.normal_range_high,
        is_from_interface: orphan.is_from_interface ?? true,
        is_calculated: orphan.is_calculated ?? false,
        entered_at: orphan.entered_at || new Date().toISOString(),
        entered_by: orphan.entered_by || "INTERFACE",
        status: "pending",
        updated_at: new Date().toISOString(),
        param_code: orphan.param_code,
        parameter_name: orphan.parameter_name,
      };
      if (targetHasDownstream && orphanHasVal) {
        payload.status = "entered";
        payload.entered_by = "Administrator";
      }

      if (target) {
        const targetEmpty = target.result_value == null || String(target.result_value).trim() === "";
        if (!targetEmpty && !orphanHasVal) {
          await supabase.from("patient_results").delete().eq("id", orphan.id);
          continue;
        }
        const { error } = await supabase.from("patient_results").update(payload).eq("id", target.id);
        if (error) continue;
      } else {
        const { error } = await supabase.from("patient_results").insert({
          registration_id: registrationId,
          test_id: targetTestId,
          parameter_id: orphan.parameter_id,
          ...payload,
        });
        if (error) continue;
      }
      await supabase.from("patient_results").delete().eq("id", orphan.id);
      healed++;
    }
    return healed;
  } catch (err) {
    console.error("healOrphanResultsForRegistration error:", err);
    return 0;
  }
}

/** Lightweight status bump so Verification / Results queues refresh correctly. */
async function bumpRegistrationStatusAfterInterfaceEnter(
  supabase: any,
  registrationId: string,
  acceptedTestIds: Set<string>,
): Promise<void> {
  try {
    const { data: results } = await supabase
      .from("patient_results")
      .select("test_id, status")
      .eq("registration_id", registrationId);
    const tracked = new Set<string>();
    const statuses: string[] = [];
    for (const r of results || []) {
      if (!r.test_id || !acceptedTestIds.has(r.test_id)) continue;
      statuses.push(r.status);
      if (["entered", "results_entered", "verified", "approved", "dispatched"].includes(r.status)) {
        tracked.add(r.test_id);
      }
    }
    const hasUntracked = Array.from(acceptedTestIds).some((id) => !tracked.has(id));
    const enteredish = statuses.filter((s) => ["entered", "results_entered"].includes(s));
    const hasVerified = statuses.some((s) => s === "verified");
    const hasApproved = statuses.some((s) => s === "approved");
    const hasDispatched = statuses.some((s) => s === "dispatched");

    let newStatus = "partial_processing";
    if (hasDispatched) newStatus = hasUntracked ? "partially_dispatched" : "dispatched";
    else if (hasApproved) newStatus = hasUntracked ? "partially_approved" : "approved";
    else if (hasVerified) newStatus = hasUntracked ? "partial_verified" : "verified";
    else if (enteredish.length > 0 && !hasUntracked && enteredish.length === statuses.length) {
      newStatus = "processed";
    } else if (enteredish.length > 0) {
      newStatus = "partial_processing";
    }

    const { data: reg } = await supabase
      .from("patient_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    const current = String(reg?.status || "");
    // Never downgrade past verification/approval from an interface bump
    const rank: Record<string, number> = {
      registered: 0,
      sample_collected: 1,
      partially_collected: 1,
      sample_accepted: 2,
      partially_accepted: 2,
      processing: 3,
      partial_processing: 3,
      processed: 4,
      partial_verified: 5,
      verified: 6,
      partially_approved: 7,
      approved: 8,
      partially_dispatched: 9,
      dispatched: 10,
      repeat_collection: 2,
    };
    if ((rank[newStatus] ?? 0) >= (rank[current] ?? 0) || current === "sample_accepted" || current === "partially_accepted" || current === "processing") {
      await supabase
        .from("patient_registrations")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", registrationId);
    }
  } catch (err) {
    console.error("bumpRegistrationStatusAfterInterfaceEnter error:", err);
  }
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
        const staffOk = await verifyStaffJwt(req);
        if (!staffOk) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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
              const code = normalizeInterfaceResultCode(
                it.code || it.test_code || "",
                it.name || it.test_name || "",
              );
              if (!code || latestByCode[code] !== undefined) continue;
              latestByCode[code] = { ...it, code };
            }
          }
          const reprocessResults = Object.entries(latestByCode).map(([code, it]) => ({ ...it, code }));
          if (reprocessResults.length === 0) continue;

          // Resolve registration
          const invoiceNumber = sampleId.replace(/-[A-Za-z0-9]+$/, "");
          const { data: regRows } = await supabase
            .from("patient_registrations")
            .select("id, tests, gender, dob")
            .eq("invoice_number", invoiceNumber)
            .limit(1);
          const registration = regRows?.[0];
          if (!registration) continue;
          if (filterRegistrationId && registration.id !== filterRegistrationId) continue;

          processedOrders++;
          const registrationId = registration.id;
          const acceptedTestIds = await loadAcceptedTestIds(supabase, registrationId);

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
          await attachRangeMeta(supabase, paramRows || [], { gender: registration.gender, dob: registration.dob });
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
            .select("id, parameter_id, test_id, status")
            .eq("registration_id", registrationId);
          const existingByKey: Record<string, any> = {};
          for (const er of existingRows || []) {
            existingByKey[`${er.test_id}||${er.parameter_id}`] = er;
          }

          const insertPayload: any[] = [];
          const keepTestsByParam: Record<string, string[]> = {};
          let skippedNoAcceptedOwner = 0;
          for (const sr of mappedItems) {
            const param = paramByCode[sr.test_code];
            if (!param) continue;
            const candidateTestIds = testIdsByParam[param.id] || [];
            const targetTestIds = resolveAcceptedBridgeTestIds(candidateTestIds, acceptedTestIds);
            if (targetTestIds.length === 0) {
              skippedNoAcceptedOwner++;
              continue;
            }

            const convertedValue = applyUnitConversion(sr.result_value, param, sr.unit);
            const flag = computeFlagFromInterface(convertedValue, param);

            const referenceRange = param.normal_range_text
              || (param.normal_range_low != null && param.normal_range_high != null
                  ? `${param.normal_range_low} - ${param.normal_range_high}`
                  : "");

            const nowIso = new Date().toISOString();
            keepTestsByParam[param.id] = targetTestIds;

            for (const testId of targetTestIds) {
              const existing = existingByKey[`${testId}||${param.id}`];
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
                // Prevent duplicate inserts if the same param appears twice in this batch
                existingByKey[`${testId}||${param.id}`] = { status: "pending" };
              }
            }
          }

          if (insertPayload.length > 0) {
            const { error: insErr } = await supabase.from("patient_results").insert(insertPayload);
            if (!insErr) totalPushed += insertPayload.length;
          }

          await deletePendingOutsideKeepTests(supabase, registrationId, keepTestsByParam);
          if (skippedNoAcceptedOwner > 0) {
            console.warn(
              `reprocess: skipped ${skippedNoAcceptedOwner} mapped result(s) — no accepted-tube owner for registration ${registrationId}`,
            );
          }

          // Auto-evaluate calculated parameters now that fresh values landed
          await autoCalcDependentParams(supabase, registrationId);
          await healOrphanResultsForRegistration(supabase, registrationId);
          const autoEntered = await autoEnterCompleteInterfaceTests(supabase, registrationId);

          if (totalPushed > 0 || autoEntered > 0) {
            await notifyResultUpdate(supabase, registrationId, "reprocess");
          }

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
      if (!checkIngestSecret(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      const machineAliases = machineIdAliases(machineId);
      const filteredTests = machineId
        ? enrichedTests.filter((t) =>
            !t.machine_id ||
            machineAliases.has(String(t.machine_id).toLowerCase())
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
      if (!checkIngestSecret(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json();
      const { action, sample_id, order_id, results, machine_id: bodyMachineId } = body;

      if (action !== "results" || !sample_id || !Array.isArray(results)) {
        return new Response(
          JSON.stringify({ error: "Required: {action:'results', sample_id, results:[...]}" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const machineId = bodyMachineId || "";

      // Find matching order — prefer the analyzer that posted (CBC vs chemistry
      // share one barcode / sample_id).
      let orderId = order_id;
      if (!orderId) {
        const { data: orders } = await supabase
          .from("lims_test_orders").select("id, tests")
          .eq("sample_id", sample_id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false });
        orderId = resolveOrderForMachine(orders || [], machineId);
      }

      // Fetch all code mappings for the incoming codes (1 machine_code → N internal codes allowed)
      const incomingCodes = results
        .map((r: any) => normalizeInterfaceResultCode(r.code || r.test_code || "", r.name || r.test_name || ""))
        .filter(Boolean);
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
        const code = normalizeInterfaceResultCode(r.code || r.test_code || "", r.name || r.test_name || "");
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
      let skippedNoAcceptedOwner = 0;
      let registrationResolved = false;
      let autoEnteredTests = 0;
      try {
        // 1) Resolve registration_id from sample_id (strip trailing letter suffix)
        const invoiceNumber = sample_id.replace(/-[A-Za-z0-9]+$/, "");
        const { data: regRows } = await supabase
          .from("patient_registrations")
          .select("id, tests, gender, dob")
          .eq("invoice_number", invoiceNumber)
          .limit(1);
        const registration = regRows?.[0];

        if (registration && mappedRows.length > 0) {
          registrationResolved = true;
          const registrationId = registration.id;
          const acceptedTestIds = await loadAcceptedTestIds(supabase, registrationId);

          // 2) Resolve parameters by param_code
          const paramCodes = Array.from(new Set(mappedRows.map((r) => r.test_code).filter(Boolean)));
          const { data: paramRows } = await supabase
            .from("report_test_parameters")
            .select("id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, unit_conversion_enabled, unit_conversion_operator, unit_conversion_value")
            .in("param_code", paramCodes);
          await attachRangeMeta(supabase, paramRows || [], { gender: registration.gender, dob: registration.dob });
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
            .select("id, parameter_id, test_id, status, result_value")
            .eq("registration_id", registrationId);
          const existingByKey: Record<string, any> = {};
          for (const er of existingRows || []) {
            existingByKey[`${er.test_id}||${er.parameter_id}`] = er;
          }

          const insertPayload: any[] = [];
          const keepTestsByParam: Record<string, string[]> = {};
          for (const mr of mappedRows) {
            const param = paramByCode[mr.test_code];
            if (!param) continue;
            const candidateTestIds = testIdsByParam[param.id] || [];
            const targetTestIds = resolveAcceptedBridgeTestIds(candidateTestIds, acceptedTestIds);
            if (targetTestIds.length === 0) {
              skippedNoAcceptedOwner++;
              continue;
            }

            // Compute flag (numeric → H/L/N; qualitative/descriptive → N or X)
            const convertedValue = applyUnitConversion(mr.result_value, param, mr.unit);
            const flag = computeFlagFromInterface(convertedValue, param);

            const referenceRange = param.normal_range_text
              || (param.normal_range_low != null && param.normal_range_high != null
                  ? `${param.normal_range_low} - ${param.normal_range_high}`
                  : "");

            const nowIso = new Date().toISOString();
            keepTestsByParam[param.id] = targetTestIds;

            for (const testId of targetTestIds) {
              const existing = existingByKey[`${testId}||${param.id}`];
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
                existingByKey[`${testId}||${param.id}`] = { status: "pending" };
              }
            }
          }

          if (insertPayload.length > 0) {
            const { error: insErr } = await supabase.from("patient_results").insert(insertPayload);
            if (!insErr) patientResultsWritten += insertPayload.length;
            else console.error("patient_results insert error:", insErr);
          }

          // Drop orphan pending rows for the same parameters under non-accepted / non-kept test_ids
          await deletePendingOutsideKeepTests(supabase, registrationId, keepTestsByParam);
          if (skippedNoAcceptedOwner > 0) {
            console.warn(
              `submit_results: skipped ${skippedNoAcceptedOwner} mapped result(s) — no accepted-tube owner for registration ${registrationId}`,
            );
          }

          // Auto-evaluate calculated parameters now that fresh values landed
          const calcWritten = await autoCalcDependentParams(supabase, registrationId);
          patientResultsWritten += calcWritten;

          // Move orphan writes (wrong test_id) onto accepted-tube tests
          await healOrphanResultsForRegistration(supabase, registrationId);

          // Fully-complete interfaced tests → Save & Verify (status=entered)
          const autoEntered = await autoEnterCompleteInterfaceTests(supabase, registrationId);
          autoEnteredTests = autoEntered;

          if (patientResultsWritten > 0 || autoEntered > 0) {
            await notifyResultUpdate(supabase, registrationId, "interface");
          }
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
            const code = normalizeInterfaceResultCode(r.code || r.test_code || "", r.name || r.test_name || "");
            const first = codeMap[code]?.[0];
            return first && (first.mapped_param_code || first.mapped_test_code);
          }).map((r: any) => normalizeInterfaceResultCode(r.code || r.test_code || "", r.name || r.test_name || "")));

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

      const histStats = await storeAnalyzerHistograms(
        supabase,
        sample_id,
        machineId,
        String(body.format || ""),
        Array.isArray(body.histograms) ? body.histograms : [],
      );

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
        skipped_no_accepted_owner: skippedNoAcceptedOwner,
        auto_entered_tests: autoEnteredTests,
        histograms_received: histStats.received,
        histograms_stored: histStats.stored,
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
