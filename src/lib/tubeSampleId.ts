/**
 * Unique per-tube barcode / lims_test_orders.sample_id.
 *
 * Historically unsuffixed tubes (EDTA, PLAIN, URINE, …) all used the bare
 * invoice number, so scanning one barcode returned CBC + chemistry + urine
 * together. Fluoride already used a custom suffix like "-F".
 *
 * Rule:
 *   1. Prefer explicit tube.suffix (e.g. "-F") when present
 *   2. Else derive a short tube-type suffix (-E / -P / -U / …)
 *   3. Else fall back to last 4 of sample_uid
 *   4. Else bare invoice (single-tube edge case)
 */
export type TubeSampleIdInput = {
  suffix?: string | null;
  tube_type?: string | null;
  sample_uid?: string | null;
};

const TUBE_TYPE_SUFFIX: Array<{ match: RegExp; suffix: string }> = [
  { match: /fluoride/i, suffix: "-F" },
  { match: /\bedta\b/i, suffix: "-E" },
  { match: /\bplain\b|\bserum\b|clot/i, suffix: "-P" },
  { match: /urine/i, suffix: "-U" },
  { match: /citrate|sodium citrate/i, suffix: "-C" },
  { match: /heparin/i, suffix: "-H" },
  { match: /esr/i, suffix: "-R" },
  { match: /gel/i, suffix: "-G" },
];

export function tubeTypeBarcodeSuffix(tubeType?: string | null): string | null {
  const t = (tubeType || "").trim();
  if (!t) return null;
  for (const row of TUBE_TYPE_SUFFIX) {
    if (row.match.test(t)) return row.suffix;
  }
  // Stable short code from tube type for unknown containers
  const compact = t.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!compact) return null;
  return `-${compact.slice(0, 3)}`;
}

export function getTubeSampleId(
  invoiceNumber: string | null | undefined,
  tube: TubeSampleIdInput,
): string {
  const invoice = String(invoiceNumber || "").trim();
  if (!invoice) return "";

  const rawSuffix = (tube.suffix || "").trim();
  if (rawSuffix) {
    return rawSuffix.startsWith("-") ? `${invoice}${rawSuffix}` : `${invoice}${rawSuffix}`;
  }

  const typeSuffix = tubeTypeBarcodeSuffix(tube.tube_type);
  if (typeSuffix) return `${invoice}${typeSuffix}`;

  const uid = (tube.sample_uid || "").trim();
  if (uid.length >= 4) return `${invoice}-${uid.slice(-4)}`;

  return invoice;
}

/** Strip tube suffix from a scanned sample_id to recover the invoice number. */
export function invoiceFromSampleId(sampleId: string): string {
  return String(sampleId || "").replace(/-[A-Za-z0-9]+$/, "");
}