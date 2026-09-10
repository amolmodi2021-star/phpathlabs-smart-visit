import { supabase } from "@/integrations/supabase/client";
import { enqueueWhatsAppConsoleMessage } from "@/lib/whatsappConsoleBridge";
import { patientDisplayName } from "@/lib/patientDisplayName";

export const PENDING_SAMPLE_REMINDER_TEMPLATE_KEY = "pending_sample_collection_reminder";

export const PENDING_SAMPLE_REMINDER_MAX_SENDS = 2;
export const PENDING_SAMPLE_REMINDER_INTERVAL_DAYS = 3;
const INTERVAL_MS = PENDING_SAMPLE_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE =
  "Dear {patient_name},\n\nSample collection is still pending for the following test(s) (Invoice {invoice_number}):\n\n{test_list}\n\nPlease visit the lab / arrange collection at the earliest.\n\nPH PathLabs\nLabLine: 6356 55 66 99";

export type PendingSampleReminderReg = {
  id: string;
  patient_name?: string | null;
  title?: string | null;
  mobile_number?: string | null;
  invoice_number?: string | null;
  sample_collection_reminder_sent_count?: number | null;
  sample_collection_reminder_last_sent_at?: string | null;
};

export type PendingSampleReminderEligibility = {
  eligible: boolean;
  sentCount: number;
  reason?: string;
  nextEligibleAt?: Date | null;
};

/** True when count < 2 and last send was at least 3 days ago (or never sent). */
export function getPendingSampleReminderEligibility(
  reg: Pick<PendingSampleReminderReg, "sample_collection_reminder_sent_count" | "sample_collection_reminder_last_sent_at">,
  now: Date = new Date(),
): PendingSampleReminderEligibility {
  const sentCount = Number(reg.sample_collection_reminder_sent_count || 0);
  if (sentCount >= PENDING_SAMPLE_REMINDER_MAX_SENDS) {
    return {
      eligible: false,
      sentCount,
      reason: "Maximum 2 reminders already sent",
      nextEligibleAt: null,
    };
  }
  const lastRaw = reg.sample_collection_reminder_last_sent_at;
  if (lastRaw) {
    const lastAt = new Date(lastRaw);
    if (!Number.isNaN(lastAt.getTime())) {
      const nextEligibleAt = new Date(lastAt.getTime() + INTERVAL_MS);
      if (now.getTime() < nextEligibleAt.getTime()) {
        return {
          eligible: false,
          sentCount,
          reason: "Wait 3 days from the last reminder",
          nextEligibleAt,
        };
      }
    }
  }
  return { eligible: true, sentCount, nextEligibleAt: null };
}

/** WhatsApp bullet lines: "- Test name" (dash + space). */
export function formatPendingTestList(testNames: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of testNames) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique.map((n) => "- " + n).join("\n");
}

export function buildPendingSampleReminderMessage(opts: {
  template: string;
  patientName: string;
  invoiceNumber: string;
  mobile: string;
  testNames: string[];
}): string {
  const testList = formatPendingTestList(opts.testNames);
  const testCount = String(
    testList ? testList.split("\n").filter(Boolean).length : 0,
  );
  return (opts.template || DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE)
    .split("{patient_name}").join(opts.patientName || "Patient")
    .split("{invoice_number}").join(opts.invoiceNumber || "")
    .split("{mobile}").join(opts.mobile || "")
    .split("{test_list}").join(testList)
    .split("{test_count}").join(testCount)
    .trim();
}

export async function loadPendingSampleReminderTemplate(): Promise<string> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("template_value")
    .eq("template_key", PENDING_SAMPLE_REMINDER_TEMPLATE_KEY)
    .maybeSingle();
  if (error) throw error;
  const v = String((data as any)?.template_value || "").trim();
  return v || DEFAULT_PENDING_SAMPLE_REMINDER_TEMPLATE;
}

/** Queue plain-text WhatsApp via Console outbox (same path as invoice/report, no media). */
export async function enqueuePendingSampleCollectionReminder(opts: {
  registration: PendingSampleReminderReg;
  testNames: string[];
  template?: string;
}): Promise<{ ok: boolean; outboxId?: string; sentCount?: number; error?: string }> {
  const reg = opts.registration;
  const phone = String(reg.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) {
    return { ok: false, error: "Valid 10-digit mobile required" };
  }
  if (!opts.testNames.some((n) => String(n || "").trim())) {
    return { ok: false, error: "No pending tests to remind" };
  }

  const eligibility = getPendingSampleReminderEligibility(reg);
  if (!eligibility.eligible) {
    return { ok: false, error: eligibility.reason || "Reminder not eligible" };
  }

  const prevCount = eligibility.sentCount;
  const template = opts.template || (await loadPendingSampleReminderTemplate());
  const caption = buildPendingSampleReminderMessage({
    template,
    patientName: patientDisplayName(reg as any),
    invoiceNumber: String(reg.invoice_number || ""),
    mobile: phone,
    testNames: opts.testNames,
  });
  if (!caption) return { ok: false, error: "Message body is empty" };

  const res = await enqueueWhatsAppConsoleMessage({
    kind: "text",
    phone,
    patient_name: patientDisplayName(reg as any),
    registration_id: reg.id,
    invoice_number: reg.invoice_number || null,
    caption,
    payload: {
      source: "pending_sample_collection_reminder",
      test_count: opts.testNames.filter((n) => String(n || "").trim()).length,
    },
  });
  if (!res.ok) return { ok: false, error: res.error || "Failed to queue WhatsApp" };

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("patient_registrations")
    .update({
      sample_collection_reminder_sent_count: prevCount + 1,
      sample_collection_reminder_last_sent_at: now,
    } as any)
    .eq("id", reg.id)
    .eq("sample_collection_reminder_sent_count", prevCount)
    .select("sample_collection_reminder_sent_count")
    .maybeSingle();

  if (updErr) {
    return { ok: true, outboxId: res.id, sentCount: prevCount + 1, error: updErr.message };
  }

  return {
    ok: true,
    outboxId: res.id,
    sentCount: Number((updated as any)?.sample_collection_reminder_sent_count ?? prevCount + 1),
  };
}

