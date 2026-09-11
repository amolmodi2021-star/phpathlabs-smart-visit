/**
 * Heal bill_cancellation rows whose refund landed in Cash (or wrong mode)
 * instead of the original registration_payment mode columns.
 *
 * Usage:
 *   node scripts/_heal_bill_cancel_mode_mismatch.mjs [invoice]
 *   node scripts/_heal_bill_cancel_mode_mismatch.mjs --apply [invoice]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadEnvFile(".env");
loadEnvFile("supabase/.env.cloud-phpl-secrets");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const invoiceArg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || null;
const sb = createClient(url, key, { auth: { persistSession: false } });

const MODE_COLS = [
  ["cash_amount", "Cash"],
  ["gpay_amount", "GPay"],
  ["paytm_amount", "Paytm"],
  ["credit_card_amount", "Credit Card"],
  ["neft_amount", "NEFT"],
];

function modeVector(row) {
  return Object.fromEntries(MODE_COLS.map(([c]) => [c, Number(row?.[c] || 0)]));
}

function absModes(modes) {
  return Object.fromEntries(Object.entries(modes).map(([k, v]) => [k, Math.abs(Number(v) || 0)]));
}

function modesLabel(abs) {
  return MODE_COLS.filter(([c]) => abs[c] > 0.009)
    .map(([, label]) => label)
    .join("/");
}

function sameShape(a, b) {
  return MODE_COLS.every(([c]) => Math.abs((a[c] || 0) - (b[c] || 0)) < 0.05);
}

let q = sb
  .from("payment_transactions")
  .select(
    "id, registration_id, invoice_number, transaction_type, transaction_date, cash_amount, gpay_amount, paytm_amount, credit_card_amount, neft_amount, refund_amount, total_amount, remarks, patient_name",
  )
  .in("transaction_type", ["bill_cancellation", "old_bill_cancellation"])
  .order("transaction_date", { ascending: false })
  .limit(200);

if (invoiceArg) q = q.eq("invoice_number", invoiceArg);

const { data: cancels, error } = await q;
if (error) {
  console.error(error);
  process.exit(1);
}

let fixed = 0;
let skipped = 0;

for (const cancel of cancels || []) {
  const cancelAbs = absModes(modeVector(cancel));
  const refundAmt = Math.abs(Number(cancel.refund_amount || cancel.total_amount || 0));
  if (refundAmt < 0.009) {
    skipped++;
    continue;
  }

  const { data: regs } = await sb
    .from("payment_transactions")
    .select("id, cash_amount, gpay_amount, paytm_amount, credit_card_amount, neft_amount, paid_amount")
    .eq("registration_id", cancel.registration_id)
    .eq("transaction_type", "registration_payment")
    .order("transaction_date", { ascending: false })
    .limit(1);

  const reg = regs?.[0];
  if (!reg) {
    skipped++;
    continue;
  }

  const regAbs = absModes(modeVector(reg));
  const regSum = MODE_COLS.reduce((s, [c]) => s + regAbs[c], 0);
  if (regSum < 0.009) {
    skipped++;
    continue;
  }

  // Target: negative of registration mode split, scaled to refund amount.
  const scale = refundAmt / regSum;
  const target = Object.fromEntries(
    MODE_COLS.map(([c]) => [c, -Math.round(regAbs[c] * scale * 100) / 100]),
  );
  // Fix rounding on largest mode
  const sumNow = MODE_COLS.reduce((s, [c]) => s + target[c], 0);
  const drift = Math.round((-refundAmt - sumNow) * 100) / 100;
  if (Math.abs(drift) >= 0.01) {
    const biggest = MODE_COLS.map(([c]) => c).sort(
      (a, b) => Math.abs(target[b]) - Math.abs(target[a]),
    )[0];
    target[biggest] = Math.round((target[biggest] + drift) * 100) / 100;
  }

  const current = modeVector(cancel);
  if (sameShape(current, target)) {
    skipped++;
    continue;
  }

  const fromLabel = modesLabel(cancelAbs) || "(none)";
  const toLabel = modesLabel(absModes(target));
  console.log(
    `${apply ? "FIX" : "DRY"} ${cancel.invoice_number} ${cancel.patient_name || ""} ` +
      `${fromLabel} → ${toLabel} (refund ₹${refundAmt}) id=${cancel.id}`,
  );

  if (apply) {
    const { error: updErr } = await sb
      .from("payment_transactions")
      .update({
        ...target,
        remarks: cancel.remarks
          ? `${cancel.remarks}\n[healed] refund modes aligned to registration (${toLabel})`
          : `[healed] refund modes aligned to registration (${toLabel})`,
      })
      .eq("id", cancel.id);
    if (updErr) {
      console.error("update failed", cancel.id, updErr);
    } else {
      // Keep registration.refund_mode label in sync when present.
      await sb
        .from("patient_registrations")
        .update({ refund_mode: toLabel })
        .eq("id", cancel.registration_id);
      fixed++;
    }
  } else {
    fixed++;
  }
}

console.log(`${apply ? "Updated" : "Would update"}: ${fixed}; skipped: ${skipped}`);
if (!apply && fixed > 0) console.log("Re-run with --apply to write changes.");
