/**
 * Cancel-totals audit (PHPL cloud) — NO WhatsApp.
 *
 * Register a multi-test lab bill, cancel tests in multiple waves, then Cancel
 * Entire Bill. Assert Daily Report style nets (Gross / Discount / Final / Cash)
 * after every stage.
 *
 * LEAVES ALL DATA IN PLACE for manual inspection. Do not clean unless asked.
 *
 *   node scripts/cloud-cancel-totals-audit.mjs
 * Report → data-export/cloud-cancel-totals-audit-report.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) || line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const fileEnv = loadEnvFile(path.join(root, ".env"));
const secrets = loadEnvFile(path.join(root, "supabase", ".env.cloud-phpl-secrets"));
const API = (process.env.AUDIT_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SVC = process.env.AUDIT_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.AUDIT_ANON_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.SUPABASE_PUBLISHABLE_KEY || "";

if (!API || !SVC || !ANON) {
  console.error("Need VITE_SUPABASE_URL + service_role + anon");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(API)) {
  console.error("Refusing local:", API);
  process.exit(1);
}

const RUN = Date.now();
const MARKER = `CANCELAUDIT ${RUN}`;
const MOBILE = "9999911888";

const report = {
  startedAt: new Date().toISOString(),
  target: API,
  marker: MARKER,
  whatsapp: "disabled_by_policy",
  keepLeftovers: true,
  cleaned: false,
  steps: [],
  flaws: [],
  stages: [],
  invoice_number: null,
  registration_id: null,
  umr_number: null,
  passed: false,
};

function note(step, ok, detail = "") {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"} ${step}${detail ? " — " + detail : ""}`);
  if (!ok) report.flaws.push({ step, detail });
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function near(a, b, eps = 0.02) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= eps;
}

async function api(method, pathName, body, key = SVC, extraHeaders = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "return=representation",
    ...extraHeaders,
  };
  if (body !== undefined && body !== null && method !== "GET" && method !== "DELETE" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }
  if (method === "DELETE") headers.Prefer = extraHeaders.Prefer || "return=minimal";
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers,
    body:
      body !== undefined && body !== null && method !== "GET" && method !== "DELETE" && method !== "HEAD"
        ? JSON.stringify(body)
        : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathName} → ${res.status}: ${String(text).slice(0, 700)}`);
  }
  return data;
}

async function rpc(fn, args = {}, key = SVC) {
  return api("POST", `/rest/v1/rpc/${fn}`, args, key);
}

function paymentRowGross(row) {
  const type = row.transaction_type || "";
  const base = Number(row.gross_amount || 0);
  if (type === "bill_cancellation" || type === "old_bill_cancellation") return base;
  if (type === "registration_payment" || type === "discount_applied") {
    // No live HVC in this audit bill; still apply inference for safety.
    const final = Number(row.final_amount || 0);
    const discount = Number(row.discount_amount || 0);
    const inferred = final + discount - base;
    const hvc = inferred > 0.009 ? inferred : 0;
    return base + hvc;
  }
  return base;
}

function paymentRowPaid(row) {
  const type = row.transaction_type || "";
  if (type === "due_collection" || type === "old_due_recovered") return Number(row.total_amount || 0);
  if (type === "refund" || type === "old_bill_refund") {
    const signed = Number(row.total_amount || 0);
    if (signed !== 0) return signed;
    const refundAmt = Number(row.refund_amount || 0);
    return refundAmt ? -Math.abs(refundAmt) : 0;
  }
  return Number(row.paid_amount || 0);
}

async function loadReg(id) {
  const rows = await api(
    "GET",
    `/rest/v1/patient_registrations?id=eq.${id}&select=*`,
    null,
    SVC,
  );
  if (!rows?.[0]) throw new Error("registration missing");
  return rows[0];
}

async function loadTxns(registrationId) {
  return (
    (await api(
      "GET",
      `/rest/v1/payment_transactions?registration_id=eq.${registrationId}&select=*&order=transaction_date.asc`,
      null,
      SVC,
    )) || []
  );
}

function summarizeTxns(txns) {
  const t = {
    gross: 0,
    discount: 0,
    final: 0,
    paid: 0,
    cash: 0,
    gpay: 0,
    refund: 0,
    rows: [],
  };
  for (const r of txns) {
    const gross = paymentRowGross(r);
    const paid = paymentRowPaid(r);
    t.gross += gross;
    t.discount += Number(r.discount_amount || 0);
    t.final += Number(r.final_amount || 0);
    t.paid += paid;
    t.cash += Number(r.cash_amount || 0);
    t.gpay += Number(r.gpay_amount || 0);
    t.refund += Number(r.refund_amount || 0);
    t.rows.push({
      type: r.transaction_type,
      direction: r.direction,
      gross,
      discount: Number(r.discount_amount || 0),
      final: Number(r.final_amount || 0),
      paid,
      cash: Number(r.cash_amount || 0),
      refund: Number(r.refund_amount || 0),
      remarks: r.remarks || null,
    });
  }
  for (const k of ["gross", "discount", "final", "paid", "cash", "gpay", "refund"]) {
    t[k] = round2(t[k]);
  }
  return t;
}

async function snapshotStage(name, registrationId, expect) {
  const reg = await loadReg(registrationId);
  const txns = await loadTxns(registrationId);
  const nets = summarizeTxns(txns);
  const stage = {
    name,
    at: new Date().toISOString(),
    live: {
      bill_cancelled: !!reg.bill_cancelled,
      status: reg.status,
      gross_amount: Number(reg.gross_amount || 0),
      discount_amount: Number(reg.discount_amount || 0),
      final_amount: Number(reg.final_amount || 0),
      paid_amount: Number(reg.paid_amount || 0),
      due_amount: Number(reg.due_amount || 0),
      refund_amount: Number(reg.refund_amount || 0),
      cancelled_tests: Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [],
      active_tests: (Array.isArray(reg.tests) ? reg.tests : [])
        .filter((t) => !(Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : []).some(
          (c) => (c.test_id || c) === t.test_id,
        ))
        .map((t) => ({ test_id: t.test_id, test_name: t.test_name, price: t.price, discounted_price: t.discounted_price })),
    },
    dailyReportNets: nets,
    expect,
    checks: {},
  };

  if (expect) {
    for (const [k, v] of Object.entries(expect)) {
      const actual = nets[k];
      const ok = near(actual, v);
      stage.checks[k] = { expected: v, actual, ok };
      note(`stage.${name}.${k}`, ok, `expected ${v}, got ${actual}`);
    }
  } else {
    note(`stage.${name}.snapshot`, true, `gross=${nets.gross} final=${nets.final} cash=${nets.cash} paid=${nets.paid}`);
  }

  report.stages.push(stage);
  return { reg, txns, nets, stage };
}

function rebuildPaymentsForPaidCap(payments, newPaidCap) {
  const list = Array.isArray(payments) ? payments.filter((p) => p && !p.date) : [];
  const cap = Math.max(0, Number(newPaidCap || 0));
  const sum = list.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (sum <= 0.01 || cap <= 0.01) return [];
  return list
    .map((p) => ({
      mode: p.mode,
      amount: round2((Number(p.amount || 0) * cap) / sum),
    }))
    .filter((p) => p.amount > 0);
}

async function syncRegistrationPaymentBillSnapshot({
  registrationId,
  invoiceNumber,
  patientName,
  gross,
  discount,
  finalAmount,
  paidAmount,
  reason,
}) {
  const existing =
    (await api(
      "GET",
      `/rest/v1/payment_transactions?registration_id=eq.${registrationId}&transaction_type=eq.registration_payment&select=id,paid_amount,remarks&order=transaction_date.desc&limit=1`,
      null,
      SVC,
    )) || [];
  if (!existing[0]) throw new Error("registration_payment row missing");
  const row = existing[0];
  const frozenPaid = Number(row.paid_amount || 0);
  const due = Math.max(0, Number(finalAmount) - frozenPaid);
  const stamp = new Date().toLocaleString("en-IN");
  const editRemark = `${reason} on ${stamp} by CANCEL_AUDIT`;
  const remarks = row.remarks ? `${row.remarks}\n${editRemark}` : editRemark;
  await api(
    "PATCH",
    `/rest/v1/payment_transactions?id=eq.${row.id}`,
    {
      gross_amount: gross,
      discount_amount: discount,
      final_amount: finalAmount,
      due_amount: due,
      // intentionally do NOT overwrite paid/cash — freeze pattern
      remarks,
      patient_name: patientName,
      invoice_number: invoiceNumber,
    },
    SVC,
  );
}

async function insertTxn(row) {
  await api("POST", "/rest/v1/payment_transactions", row, SVC, { Prefer: "return=minimal" });
}

async function cancelTestsWave(regId, testIds, refundMode = "Cash") {
  const reg = await loadReg(regId);
  const tests = Array.isArray(reg.tests) ? reg.tests : [];
  const already = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
  const alreadyIds = new Set(already.map((c) => c.test_id || c));
  const newly = testIds.filter((id) => !alreadyIds.has(id));
  if (newly.length === 0) throw new Error("no new tests to cancel");

  let testBillReduction = 0;
  let cancelledGross = 0;
  let cancelledDiscount = 0;
  const newlyRows = newly.map((id) => {
    const test = tests.find((t) => t.test_id === id);
    const price = Number(test?.price || 0);
    const discounted = Number(test?.discounted_price ?? price);
    const lineDisc = Number(test?.discount || 0) || Math.max(0, price - discounted);
    testBillReduction += discounted;
    cancelledGross += price;
    cancelledDiscount += Math.min(Math.max(0, lineDisc), price);
    return {
      test_id: id,
      test_name: test?.test_name || "",
      refund_amount: discounted,
    };
  });

  const cashRefund = Math.min(Number(reg.paid_amount || 0), testBillReduction);
  const totalRefund = Number(reg.refund_amount || 0) + cashRefund;
  const newGross = Math.max(0, Number(reg.gross_amount || 0) - cancelledGross);
  const newDiscount = Math.max(0, Number(reg.discount_amount || 0) - cancelledDiscount);
  const newFinal = Math.max(0, Number(reg.final_amount || 0) - testBillReduction);
  const newPaid = Math.max(0, Number(reg.paid_amount || 0) - cashRefund);
  const scaledPayments = rebuildPaymentsForPaidCap(reg.payments, newPaid);
  const allCancelled = [
    ...already.map((c) =>
      typeof c === "object"
        ? c
        : { test_id: c, test_name: "", refund_amount: 0 },
    ),
    ...newlyRows,
  ];

  await api(
    "PATCH",
    `/rest/v1/patient_registrations?id=eq.${regId}`,
    {
      cancelled_tests: allCancelled,
      refund_amount: totalRefund,
      refund_mode: refundMode,
      refund_date: new Date().toISOString(),
      gross_amount: newGross,
      discount_amount: newDiscount,
      net_amount: Math.max(0, newGross - newDiscount),
      final_amount: newFinal,
      paid_amount: newPaid,
      due_amount: Math.max(0, newFinal - newPaid),
      payments: scaledPayments,
    },
    SVC,
  );

  // Tube cleanup for cancelled tests
  const tubes =
    (await api(
      "GET",
      `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=id,test_ids,test_names`,
      null,
      SVC,
    )) || [];
  const nameById = Object.fromEntries(tests.map((t) => [t.test_id, t.test_name || ""]));
  for (const testId of newly) {
    for (const tube of tubes) {
      const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
      if (!ids.includes(testId)) continue;
      const remaining = ids.filter((id) => id !== testId);
      if (remaining.length === 0) {
        await api("DELETE", `/rest/v1/sample_tubes?id=eq.${tube.id}`, null, SVC, { Prefer: "return=minimal" });
      } else {
        await api(
          "PATCH",
          `/rest/v1/sample_tubes?id=eq.${tube.id}`,
          {
            test_ids: remaining,
            test_names: remaining.map((id) => nameById[id] || ""),
          },
          SVC,
        );
      }
    }
  }

  // Do not rewrite registration_payment bill snapshot — keep Paid=Final on Registration.
  if (cancelledGross > 0.009 || cancelledDiscount > 0.009 || testBillReduction > 0.009) {
    await insertTxn({
      registration_id: regId,
      invoice_number: reg.invoice_number,
      patient_name: reg.patient_name,
      transaction_type: "test_cancellation",
      direction: "out",
      transaction_date: new Date().toISOString(),
      performed_by: "CANCEL_AUDIT",
      cash_amount: 0,
      gpay_amount: 0,
      paytm_amount: 0,
      credit_card_amount: 0,
      neft_amount: 0,
      total_amount: 0,
      gross_amount: -cancelledGross,
      discount_amount: -cancelledDiscount,
      final_amount: -testBillReduction,
      paid_amount: 0,
      due_amount: 0,
      refund_amount: 0,
      remarks: `${newly.length} test(s) cancelled (CANCELAUDIT) — Gross/Final offset`,
    });
  }

  if (cashRefund > 0) {
    await insertTxn({
      registration_id: regId,
      invoice_number: reg.invoice_number,
      patient_name: reg.patient_name,
      transaction_type: "refund",
      direction: "out",
      transaction_date: new Date().toISOString(),
      performed_by: "CANCEL_AUDIT",
      cash_amount: refundMode === "Cash" ? -cashRefund : 0,
      gpay_amount: 0,
      paytm_amount: 0,
      credit_card_amount: 0,
      neft_amount: refundMode === "NEFT" ? -cashRefund : 0,
      total_amount: -cashRefund,
      gross_amount: 0,
      discount_amount: 0,
      final_amount: 0,
      paid_amount: 0,
      due_amount: 0,
      refund_amount: cashRefund,
      remarks: `${newly.length} test(s) cancelled (CANCELAUDIT)`,
    });
  }

  return {
    cancelled: newlyRows,
    cashRefund,
    newGross,
    newDiscount,
    newFinal,
    newPaid,
  };
}

function resolveCancelBillSnapshot(live, frozen, alreadyRefunded = 0) {
  const liveHvc = Number(live.home_visit_charges || 0);
  let origGross = Number(live.gross_amount || 0) + liveHvc;
  let origDiscount = Number(live.discount_amount || 0);
  let origFinal = Number(live.final_amount || 0);
  const livePaid = Number(live.paid_amount || 0);
  if (origFinal <= 0.009 && frozen && Number(frozen.final_amount || 0) > 0.009) {
    origFinal = Number(frozen.final_amount || 0);
    origDiscount = Number(frozen.discount_amount || 0);
    origGross = origFinal + origDiscount;
  }
  let refundCash = 0;
  if (livePaid > 0.009) {
    // Live remaining already nets prior partial refunds.
    refundCash = livePaid;
  } else if (frozen && Number(frozen.paid_amount || 0) > 0.009) {
    refundCash = Math.max(0, Number(frozen.paid_amount || 0) - Math.max(0, Number(alreadyRefunded || 0)));
  }
  return { origGross, origDiscount, origFinal, refundCash };
}

async function cancelEntireBill(regId, refundMode = "Cash") {
  const reg = await loadReg(regId);
  const frozenRows =
    (await api(
      "GET",
      `/rest/v1/payment_transactions?registration_id=eq.${regId}&transaction_type=eq.registration_payment&select=gross_amount,discount_amount,final_amount,paid_amount&order=transaction_date.desc&limit=1`,
      null,
      SVC,
    )) || [];
  const frozen = frozenRows[0]
    ? {
        gross_amount: Number(frozenRows[0].gross_amount || 0),
        discount_amount: Number(frozenRows[0].discount_amount || 0),
        final_amount: Number(frozenRows[0].final_amount || 0),
        paid_amount: Number(frozenRows[0].paid_amount || 0),
      }
    : null;
  const refundRows =
    (await api(
      "GET",
      `/rest/v1/payment_transactions?registration_id=eq.${regId}&transaction_type=in.(refund,old_bill_refund)&select=refund_amount,total_amount`,
      null,
      SVC,
    )) || [];
  const alreadyRefunded = refundRows.reduce((s, r) => {
    const ra = Number(r.refund_amount || 0);
    if (ra > 0) return s + ra;
    return s + Math.abs(Number(r.total_amount || 0));
  }, 0);

  const { origGross, origDiscount, origFinal, refundCash } = resolveCancelBillSnapshot(
    reg,
    frozen,
    alreadyRefunded,
  );

  await api(
    "PATCH",
    `/rest/v1/patient_registrations?id=eq.${regId}`,
    {
      bill_cancelled: true,
      status: "cancelled",
      refund_amount: Number(reg.refund_amount || 0) + refundCash,
      refund_mode: refundMode,
      refund_date: new Date().toISOString(),
      final_amount: 0,
      paid_amount: 0,
      due_amount: 0,
      payments: [],
    },
    SVC,
  );

  await api(
    "DELETE",
    `/rest/v1/sample_tubes?registration_id=eq.${regId}&status=in.(pending,deferred,collected)`,
    null,
    SVC,
    { Prefer: "return=minimal" },
  );

  if (refundCash > 0) {
    await insertTxn({
      registration_id: regId,
      invoice_number: reg.invoice_number,
      patient_name: reg.patient_name,
      transaction_type: "refund",
      direction: "out",
      transaction_date: new Date().toISOString(),
      performed_by: "CANCEL_AUDIT",
      cash_amount: refundMode === "Cash" ? -refundCash : 0,
      gpay_amount: 0,
      paytm_amount: 0,
      credit_card_amount: 0,
      neft_amount: refundMode === "NEFT" ? -refundCash : 0,
      total_amount: -refundCash,
      gross_amount: 0,
      discount_amount: 0,
      final_amount: 0,
      paid_amount: 0,
      due_amount: 0,
      refund_amount: refundCash,
      remarks: `Refund of ₹${refundCash} via ${refundMode} for cancelled invoice ${reg.invoice_number} (CANCELAUDIT)`,
    });
  }

  if (origFinal > 0.009 || origGross > 0.009) {
    await insertTxn({
      registration_id: regId,
      invoice_number: reg.invoice_number,
      patient_name: reg.patient_name,
      transaction_type: "bill_cancellation",
      direction: "out",
      transaction_date: new Date().toISOString(),
      performed_by: "CANCEL_AUDIT",
      cash_amount: 0,
      gpay_amount: 0,
      paytm_amount: 0,
      credit_card_amount: 0,
      neft_amount: 0,
      total_amount: 0,
      gross_amount: -origGross,
      discount_amount: -origDiscount,
      final_amount: -origFinal,
      paid_amount: 0,
      due_amount: 0,
      refund_amount: 0,
      remarks: `Bill cancelled — original invoice ${reg.invoice_number} (CANCELAUDIT), final ₹${origFinal}`,
    });
  }

  return { origGross, origDiscount, origFinal, refundCash, alreadyRefunded, frozen };
}

async function main() {
  note("target", true, API);
  note("policy.whatsapp", true, "sends disabled");
  note("policy.keep_leftovers", true, "will NOT clean up — user will inspect then ask to clear");

  try {
    const testsRaw =
      (await api(
        "GET",
        "/rest/v1/tests?select=id,test_name,test_code,price,sample_tube,tube_color,sample_type&is_active=eq.true&is_outsourced=eq.false&order=price.desc&limit=80",
        null,
        ANON,
      )) || [];
    const picked = testsRaw.filter((t) => Number(t.price || 0) >= 50).slice(0, 6);
    if (picked.length < 6) throw new Error(`Need 6 priced tests, got ${picked.length}`);

    // Apply a small line discount on 2 tests so discount column is exercised
    const testRows = picked.map((t, i) => {
      const price = Number(t.price || 0);
      const discount = i < 2 ? Math.min(20, Math.floor(price * 0.1)) : 0;
      return {
        test_id: t.id,
        test_name: t.test_name,
        price,
        discount,
        discounted_price: price - discount,
        item_type: "test",
        fasting_required: false,
      };
    });
    const gross = testRows.reduce((s, t) => s + t.price, 0);
    const discountAmt = testRows.reduce((s, t) => s + t.discount, 0);
    const finalAmt = gross - discountAmt;

    const tubesMap = new Map();
    for (const t of picked) {
      const key = `${t.sample_tube || "DEFAULT"}||${t.tube_color || ""}||${t.sample_type || ""}`;
      if (!tubesMap.has(key)) {
        tubesMap.set(key, {
          tube_type: t.sample_tube || "DEFAULT",
          tube_color: t.tube_color || null,
          sample_type: t.sample_type || null,
          suffix: "",
          test_ids: [],
          test_names: [],
          status: "pending",
        });
      }
      const g = tubesMap.get(key);
      g.test_ids.push(t.id);
      g.test_names.push(t.test_name);
    }
    const tubes = Array.from(tubesMap.values());

    report.plan = {
      tests: testRows.map((t) => ({
        test_id: t.test_id,
        test_name: t.test_name,
        price: t.price,
        discount: t.discount,
        discounted_price: t.discounted_price,
      })),
      gross,
      discountAmt,
      finalAmt,
      waves: "cancel 2, cancel 2, cancel entire bill (remaining 2)",
    };
    note("plan", true, `6 tests gross=${gross} discount=${discountAmt} final=${finalAmt}`);

    const atomic = await rpc(
      "register_patient_atomic",
      {
        p_registration: {
          title: "MR.",
          patient_name: MARKER,
          gender: "Male",
          dob: "1988-05-12",
          mobile_number: MOBILE,
          doctor_name: "SELF",
          address: "CANCEL AUDIT ADDR",
          visit_type: "lab",
          tests: testRows,
          gross_amount: gross,
          discount_amount: discountAmt,
          home_visit_charges: 0,
          net_amount: finalAmt,
          final_amount: finalAmt,
          payments: [{ mode: "Cash", amount: finalAmt }],
          paid_amount: finalAmt,
          due_amount: 0,
          status: "registered",
          registered_by: "CANCEL_AUDIT",
          remarks: "CANCELAUDIT — multi-wave cancel totals check — no WA",
        },
        p_tubes: tubes,
        p_payment: {
          patient_name: MARKER,
          transaction_type: "registration_payment",
          direction: "in",
          performed_by: "CANCEL_AUDIT",
          cash_amount: finalAmt,
          gpay_amount: 0,
          paytm_amount: 0,
          credit_card_amount: 0,
          neft_amount: 0,
          total_amount: finalAmt,
          gross_amount: gross,
          discount_amount: discountAmt,
          final_amount: finalAmt,
          paid_amount: finalAmt,
          due_amount: 0,
          remarks: "CANCELAUDIT registration — no WA",
        },
        p_home_visit_id: null,
        p_home_visit_patch: null,
      },
      ANON,
    );

    const regId = atomic?.id || atomic?.registration_id || atomic?.registration?.id;
    if (!regId) throw new Error(`register failed: ${JSON.stringify(atomic).slice(0, 500)}`);
    let reg = await loadReg(regId);
    report.registration_id = regId;
    report.invoice_number = reg.invoice_number;
    report.umr_number = reg.umr_number;
    note("register", true, `invoice=${reg.invoice_number} umr=${reg.umr_number} paid=${reg.paid_amount}`);

    // Stage 0 — after registration
    await snapshotStage("0_after_registration", regId, {
      gross,
      discount: discountAmt,
      final: finalAmt,
      cash: finalAmt,
      paid: finalAmt,
      refund: 0,
    });

    const ids = testRows.map((t) => t.test_id);
    const wave1 = ids.slice(0, 2);
    const wave2 = ids.slice(2, 4);
    // remaining 2 cancelled via Cancel Entire Bill

    // Wave 1
    const w1 = await cancelTestsWave(regId, wave1, "Cash");
    note(
      "cancel.wave1",
      true,
      `cancelled ${w1.cancelled.map((c) => c.test_name).join(", ")} refund=${w1.cashRefund}`,
    );
    // After wave1: registration_payment gross/discount/final reduced; cash frozen; + refund out
    // Net gross = remaining gross, net final = remaining final, net cash = remaining paid
    await snapshotStage("1_after_cancel_wave1", regId, {
      gross: w1.newGross,
      discount: w1.newDiscount,
      final: w1.newFinal,
      cash: w1.newPaid,
      paid: w1.newPaid,
      refund: w1.cashRefund,
    });

    // Wave 2
    const w2 = await cancelTestsWave(regId, wave2, "Cash");
    note(
      "cancel.wave2",
      true,
      `cancelled ${w2.cancelled.map((c) => c.test_name).join(", ")} refund=${w2.cashRefund}`,
    );
    await snapshotStage("2_after_cancel_wave2", regId, {
      gross: w2.newGross,
      discount: w2.newDiscount,
      final: w2.newFinal,
      cash: w2.newPaid,
      paid: w2.newPaid,
      refund: w1.cashRefund + w2.cashRefund,
    });

    // Entire bill cancel (remaining tests)
    const full = await cancelEntireBill(regId, "Cash");
    note(
      "cancel.entire_bill",
      true,
      `origGross=${full.origGross} origFinal=${full.origFinal} refundCash=${full.refundCash} alreadyRefunded=${full.alreadyRefunded}`,
    );

    // After full cancel: nets should be ~0
    await snapshotStage("3_after_cancel_entire_bill", regId, {
      gross: 0,
      discount: 0,
      final: 0,
      cash: 0,
      paid: 0,
    });

    reg = await loadReg(regId);
    report.finalLive = {
      bill_cancelled: reg.bill_cancelled,
      status: reg.status,
      gross_amount: reg.gross_amount,
      discount_amount: reg.discount_amount,
      final_amount: reg.final_amount,
      paid_amount: reg.paid_amount,
      refund_amount: reg.refund_amount,
      cancelled_tests_count: Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests.length : 0,
    };

    report.passed = report.flaws.length === 0;
    note("audit.passed", report.passed, report.passed ? "all stage nets matched" : `${report.flaws.length} flaw(s)`);
  } catch (e) {
    note("audit.error", false, e.message || String(e));
    report.passed = false;
    report.error = e.message || String(e);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.keepLeftovers = true;
    report.cleaned = false;
    report.inspectHint = {
      patient_name: MARKER,
      invoice_number: report.invoice_number,
      registration_id: report.registration_id,
      dailyReport: "Filter by invoice / patient CANCELAUDIT — leave rows until user asks to clear",
    };
    const outDir = path.join(root, "data-export");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "cloud-cancel-totals-audit-report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log("\nReport:", outPath);
    console.log("Invoice:", report.invoice_number);
    console.log("Patient:", MARKER);
    console.log("KEEP LEFTOVERS — not cleaned");
    process.exit(report.passed ? 0 : 1);
  }
}

main();