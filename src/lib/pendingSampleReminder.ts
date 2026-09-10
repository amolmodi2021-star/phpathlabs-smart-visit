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

type ClaimRow = {
  claimed: boolean;
  sent_count: number;
  last_sent_at: string | null;
  previous_last_sent_at: string | null;
  reason: string | null;
};

async function claimReminderSlot(registrationId: string): Promise<ClaimRow> {
  const { data, error } = await supabase.rpc("claim_sample_collection_reminder" as any, {
    p_registration_id: registrationId,
  } as any);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      claimed: false,
      sent_count: 0,
      last_sent_at: null,
      previous_last_sent_at: null,
      reason: "Could not claim reminder slot",
    };
  }
  return {
    claimed: !!(row as any).claimed,
    sent_count: Number((row as any).sent_count || 0),
    last_sent_at: (row as any).last_sent_at ?? null,
    previous_last_sent_at: (row as any).previous_last_sent_at ?? null,
    reason: (row as any).reason ?? null,
  };
}

async function releaseReminderSlot(claim: ClaimRow, registrationId: string): Promise<void> {
  if (!claim.claimed || !claim.last_sent_at) return;
  await supabase.rpc("release_sample_collection_reminder_claim" as any, {
    p_registration_id: registrationId,
    p_expected_count: claim.sent_count,
    p_claimed_last_sent_at: claim.last_sent_at,
    p_previous_last_sent_at: claim.previous_last_sent_at,
  } as any);
}

/** True if a reminder was already queued/sent for this registration inside the 3-day window. */
async function hasRecentReminderOutbox(registrationId: string): Promise<boolean> {
  const since = new Date(Date.now() - INTERVAL_MS).toISOString();
  const { data, error } = await supabase
    .from("whatsapp_console_outbox" as any)
    .select("id, payload, status, created_at")
    .eq("registration_id", registrationId)
    .eq("kind", "text")
    .in("status", ["pending", "claimed", "sent"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).some((row: any) => {
    const source = row?.payload?.source;
    return source === "pending_sample_collection_reminder";
  });
}

/**
 * Queue plain-text WhatsApp via Console outbox.
 * Claims the send slot in Postgres (FOR UPDATE) BEFORE enqueue so a stale list
 * on another PC cannot double-send the same patient.
 * Also refuses a second outbox row within the 3-day window (idempotent).
 */
export async function enqueuePendingSampleCollectionReminder(opts: {
  registration: PendingSampleReminderReg;
  testNames: string[];
  template?: string;
}): Promise<{ ok: boolean; outboxId?: string; sentCount?: number; error?: string; skippedStale?: boolean }> {
  const regIn = opts.registration;
  if (!opts.testNames.some((n) => String(n || "").trim())) {
    return { ok: false, error: "No pending tests to remind" };
  }

  // Always re-read from DB — never trust a stale UI row from another PC.
  const { data: freshRow, error: freshErr } = await supabase
    .from("patient_registrations")
    .select("id, patient_name, title, mobile_number, invoice_number, sample_collection_reminder_sent_count, sample_collection_reminder_last_sent_at")
    .eq("id", regIn.id)
    .maybeSingle();
  if (freshErr) return { ok: false, error: freshErr.message };
  if (!freshRow) return { ok: false, error: "Registration not found" };

  const reg = { ...regIn, ...(freshRow as any) } as PendingSampleReminderReg;
  const phone = String(reg.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) {
    return { ok: false, error: "Valid 10-digit mobile required" };
  }

  // Idempotency: never queue a second reminder WhatsApp for the same registration
  // while one already exists in the 3-day window (covers double-click / retry).
  try {
    if (await hasRecentReminderOutbox(reg.id)) {
      return {
        ok: false,
        skippedStale: true,
        sentCount: Number(reg.sample_collection_reminder_sent_count || 0),
        error: "Reminder already queued/sent for this patient",
      };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to check existing reminders" };
  }

  let claim: ClaimRow;
  try {
    claim = await claimReminderSlot(reg.id);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to claim reminder slot" };
  }
  if (!claim.claimed) {
    return {
      ok: false,
      skippedStale: true,
      sentCount: claim.sent_count,
      error: claim.reason || "Already sent from another station — refresh the list",
    };
  }

  // Re-check after claim in case another insert raced in.
  try {
    if (await hasRecentReminderOutbox(reg.id)) {
      await releaseReminderSlot(claim, reg.id);
      return {
        ok: false,
        skippedStale: true,
        sentCount: claim.sent_count,
        error: "Reminder already queued/sent for this patient",
      };
    }
  } catch (e: any) {
    await releaseReminderSlot(claim, reg.id);
    return { ok: false, error: e?.message || "Failed to re-check existing reminders" };
  }

  const template = opts.template || (await loadPendingSampleReminderTemplate());
  const caption = buildPendingSampleReminderMessage({
    template,
    patientName: patientDisplayName(reg as any),
    invoiceNumber: String(reg.invoice_number || ""),
    mobile: phone,
    testNames: opts.testNames,
  });
  if (!caption) {
    await releaseReminderSlot(claim, reg.id);
    return { ok: false, error: "Message body is empty" };
  }

  const res = await enqueueWhatsAppConsoleMessage({
    kind: "text",
    phone,
    patient_name: patientDisplayName(reg as any),
    registration_id: reg.id,
    invoice_number: reg.invoice_number || null,
    caption,
    max_attempts: 1,
    payload: {
      source: "pending_sample_collection_reminder",
      test_count: opts.testNames.filter((n) => String(n || "").trim()).length,
    },
  });

  if (!res.ok) {
    await releaseReminderSlot(claim, reg.id);
    return { ok: false, error: res.error || "Failed to queue WhatsApp" };
  }

  return {
    ok: true,
    outboxId: res.id,
    sentCount: claim.sent_count,
  };
}
