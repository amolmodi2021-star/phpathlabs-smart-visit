/** Home-visit service charge only (no tests / no sample pipeline). */

export function isHvChargeOnlyRegistration(reg: {
  hv_charge_only?: boolean | null;
  visit_type?: string | null;
  home_visit_charges?: number | string | null;
  tests?: unknown;
} | null | undefined): boolean {
  if (!reg) return false;
  if (reg.hv_charge_only === true) return true;
  const tests = Array.isArray(reg.tests) ? reg.tests : [];
  const hvc = Number(reg.home_visit_charges || 0);
  return String(reg.visit_type || "") === "home_visit" && tests.length === 0 && hvc > 0;
}

export function canSaveHvChargeOnly(opts: {
  visitType: string;
  selectedTestCount: number;
  homeVisitCharges: number;
  allowHvCharges?: boolean;
}): boolean {
  if (opts.allowHvCharges === false) return false;
  return (
    opts.visitType === "home_visit"
    && opts.selectedTestCount === 0
    && Number(opts.homeVisitCharges || 0) > 0
  );
}

/**
 * Cash/UPI already received toward home-visit charges.
 * Tests portion of the bill is assumed paid first; remainder applies to HVC.
 */
export function refundableHomeVisitCharges(reg: {
  home_visit_charges?: number | string | null;
  final_amount?: number | string | null;
  paid_amount?: number | string | null;
} | null | undefined): number {
  const hvc = Number(reg?.home_visit_charges || 0);
  if (!(hvc > 0)) return 0;
  const finalAmt = Number(reg?.final_amount || 0);
  const paid = Number(reg?.paid_amount || 0);
  const testsPortion = Math.max(0, finalAmt - hvc);
  return Math.min(hvc, Math.max(0, paid - testsPortion));
}