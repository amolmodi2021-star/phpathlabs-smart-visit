import { supabase } from "@/integrations/supabase/client";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { normalizeTitle } from "@/lib/normalizePatientFields";
import { enqueueWhatsAppConsoleMessage } from "@/lib/whatsappConsoleBridge";

export const GOOGLE_REVIEW_TEMPLATE_KEY = "google_review_request";
export const GOOGLE_REVIEW_SOURCE = "google_review_request";
export const GOOGLE_REVIEW_DELAY_MS = 5 * 60 * 1000;
const LAB_TZ = "Asia/Kolkata";

export const DEFAULT_GOOGLE_REVIEW_TEMPLATE =
  "Dear {title} {patient_name},\n\nThank you for choosing PH PathLabs. Your reports for invoice {invoice_number} have been sent.\n\nIf you were happy with our service, please rate us on Google:\nPASTE_GOOGLE_REVIEW_LINK_HERE\n\nPH PathLabs\nLabLine: 6356 55 66 99";

export type GoogleReviewTest = {
  testId: string;
  status: string;
};

/** Lab calendar day (IST) as YYYY-MM-DD. */
export function labCalendarDay(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LAB_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function isGoogleReviewEligible(opts: {
  visitType?: string | null;
  registeredAt?: string | null;
  dispatchedAt?: Date;
  tests: GoogleReviewTest[];
  dispatchingTestIds: string[];
  hvChargeOnly?: boolean;
}): { eligible: boolean; reason: string } {
  if (opts.hvChargeOnly) return { eligible: false, reason: "Home visit charge only" };
  const visit = String(opts.visitType || "").trim().toLowerCase();
  if (visit === "pickup_point") return { eligible: false, reason: "Pickup point patient" };

  const shipping = new Set(opts.dispatchingTestIds.filter(Boolean));
  const active = opts.tests.filter((t) => t.status !== "cancelled" && !String(t.testId || "").startsWith("__"));
  if (active.length === 0) return { eligible: false, reason: "No active tests" };

  const allDispatched = active.every(
    (t) => t.status === "dispatched" || shipping.has(t.testId),
  );
  if (!allDispatched) return { eligible: false, reason: "Some reports are still pending" };

  const dispatchedAt = opts.dispatchedAt || new Date();
  const registeredDay = labCalendarDay(opts.registeredAt);
  const dispatchDay = labCalendarDay(dispatchedAt);
  if (!registeredDay || registeredDay !== dispatchDay) {
    return { eligible: false, reason: "Last report was not dispatched on the registration day" };
  }
  return { eligible: true, reason: "" };
}

export function buildGoogleReviewMessage(opts: {
  template: string;
  title?: string | null;
  patientName?: string | null;
  gender?: string | null;
  invoiceNumber?: string | null;
  umrNumber?: string | null;
  mobile?: string | null;
}): string {
  const title = normalizeTitle(opts.title);
  const name = String(opts.patientName || "").trim();
  const full = patientDisplayName({
    title: opts.title,
    patient_name: opts.patientName,
    gender: opts.gender,
  });
  const map: Record<string, string> = {
    title,
    patient_name: name || "Patient",
    patient_full_name: full === "—" ? (name || "Patient") : full,
    invoice_number: String(opts.invoiceNumber || "").trim(),
    umr_number: String(opts.umrNumber || "").trim(),
    mobile: String(opts.mobile || "").replace(/\D/g, "").slice(-10),
  };
  let out = opts.template || DEFAULT_GOOGLE_REVIEW_TEMPLATE;
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export async function loadGoogleReviewTemplate(): Promise<string> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("template_value")
    .eq("template_key", GOOGLE_REVIEW_TEMPLATE_KEY)
    .maybeSingle();
  if (error) throw error;
  const v = String((data as any)?.template_value || "").trim();
  return v || DEFAULT_GOOGLE_REVIEW_TEMPLATE;
}

export async function maybeQueueGoogleReviewAfterDispatch(opts: {
  registration: any;
  tests: GoogleReviewTest[];
  dispatchingTestIds: string[];
  dispatchedAt?: Date;
  hvChargeOnly?: boolean;
}): Promise<{ queued: boolean; reason?: string; outboxId?: string }> {
  const reg = opts.registration || {};
  const check = isGoogleReviewEligible({
    visitType: reg.visit_type,
    registeredAt: reg.created_at,
    dispatchedAt: opts.dispatchedAt,
    tests: opts.tests,
    dispatchingTestIds: opts.dispatchingTestIds,
    hvChargeOnly: opts.hvChargeOnly,
  });
  if (!check.eligible) return { queued: false, reason: check.reason };

  const phone = String(reg.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) return { queued: false, reason: "No valid mobile number" };

  const template = await loadGoogleReviewTemplate();
  const caption = buildGoogleReviewMessage({
    template,
    title: reg.title,
    patientName: reg.patient_name,
    gender: reg.gender,
    invoiceNumber: reg.invoice_number,
    umrNumber: reg.umr_number,
    mobile: phone,
  });
  if (!caption) return { queued: false, reason: "Review message is empty" };

  const sendAt = new Date((opts.dispatchedAt || new Date()).getTime() + GOOGLE_REVIEW_DELAY_MS);
  const res = await enqueueWhatsAppConsoleMessage({
    kind: "text",
    phone,
    patient_name: patientDisplayName(reg),
    registration_id: reg.id,
    invoice_number: reg.invoice_number || null,
    caption,
    max_attempts: 1,
    next_retry_at: sendAt.toISOString(),
    payload: { source: GOOGLE_REVIEW_SOURCE },
  });
  if (!res.ok) {
    const err = String(res.error || "");
    if (/duplicate key|unique constraint|idx_wa_outbox_one_google_review/i.test(err)) {
      return { queued: false, reason: "Review request already queued" };
    }
    return { queued: false, reason: res.error || "Failed to queue review WhatsApp" };
  }
  return { queued: true, outboxId: res.id };
}