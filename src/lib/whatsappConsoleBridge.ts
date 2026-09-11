import { supabase } from "@/integrations/supabase/client";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";
import {
  CLOUDINARY_SAFE_UPLOAD_BYTES,
  splitPdfBlobUnderMaxBytes,
} from "@/lib/splitPdfByMaxBytes";

export type WhatsAppConsoleOutboxKind = "invoice" | "report" | "text" | "image";

/** Cloudinary folder root shared with loyalty cards (unsigned preset). */
const WA_MEDIA_FOLDER_ROOT = "loyalty-cards";

export interface EnqueueWhatsAppConsolePayload {
  kind?: WhatsAppConsoleOutboxKind;
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number?: string | null;
  caption?: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  payload?: Record<string, unknown>;
  /** Default 2. Use 1 for plain-text reminders to avoid false-failure retries. */
  max_attempts?: number;
}

function phone10(raw: string): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

/** Queue a WhatsApp send for WhatsApp Console middleware to deliver. */
export async function enqueueWhatsAppConsoleMessage(
  input: EnqueueWhatsAppConsolePayload,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const phone = phone10(input.phone);
  if (phone.length !== 10) {
    return { ok: false, error: "Valid 10-digit mobile required" };
  }

  const maxAttempts = Math.min(Math.max(Number(input.max_attempts) || 2, 1), 5);
  const row = {
    kind: input.kind || "text",
    phone,
    patient_name: input.patient_name || null,
    registration_id: input.registration_id || null,
    invoice_number: input.invoice_number || null,
    caption: input.caption || null,
    media_url: input.media_url || null,
    media_mime: input.media_mime || (input.media_url ? "image/jpeg" : null),
    status: "pending",
    max_attempts: maxAttempts,
    payload: input.payload || {},
  };

  const { data, error } = await supabase
    .from("whatsapp_console_outbox" as any)
    .insert(row as any)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as any)?.id };
}

/** Clear terminal failed queue rows after staff send the file manually. */
export async function dismissFailedWhatsAppConsoleJobs(
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!unique.length) return { ok: true };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("whatsapp_console_outbox" as any)
    .update({
      status: "cancelled",
      last_error: "manual_send",
      media_url: null,
      next_retry_at: null,
      claimed_at: null,
      claimed_by: null,
      updated_at: now,
    } as any)
    .in("id", unique)
    .eq("status", "failed");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Clear every failed WhatsApp Console outbox row (removes Dispatch failure badges). */
export async function dismissAllFailedWhatsAppConsoleJobs(
  reason = "cleared_by_staff",
): Promise<{ ok: boolean; cleared: number; error?: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("whatsapp_console_outbox" as any)
    .update({
      status: "cancelled",
      last_error: reason,
      media_url: null,
      next_retry_at: null,
      claimed_at: null,
      claimed_by: null,
      updated_at: now,
    } as any)
    .eq("status", "failed")
    .select("id");
  if (error) return { ok: false, cleared: 0, error: error.message };
  return { ok: true, cleared: (data || []).length };
}

/** Upload invoice JPEG to Cloudinary (bytes unchanged) and enqueue for Console delivery. */
export async function enqueueInvoiceForWhatsAppConsole(opts: {
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number: string;
  caption: string;
  blob: Blob;
  /** When true (manual resend from Registered Patients), allow a new row after a prior `sent`. */
  forceResend?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string; deduped?: boolean }> {
  const phone = phone10(opts.phone);
  if (phone.length !== 10) return { ok: false, error: "Valid 10-digit mobile required" };

  const invoiceNumber = String(opts.invoice_number || "").trim();
  if (!invoiceNumber) return { ok: false, error: "Invoice number required" };

  // Avoid double-queue: always skip in-flight; skip already-sent unless explicit resend.
  // Failed rows may be re-queued. Manual WhatsApp from Registered Patients passes forceResend.
  const blockStatuses = opts.forceResend
    ? (["pending", "claimed"] as const)
    : (["pending", "claimed", "sent"] as const);
  const { data: existing, error: existErr } = await supabase
    .from("whatsapp_console_outbox" as any)
    .select("id")
    .eq("kind", "invoice")
    .eq("invoice_number", invoiceNumber)
    .in("status", [...blockStatuses])
    .limit(1);
  if (existErr) return { ok: false, error: existErr.message };
  if (existing && (existing as any[]).length > 0) {
    return { ok: true, id: (existing as any[])[0].id, deduped: true };
  }

  const safeInvoice = invoiceNumber.replace(/[^a-zA-Z0-9_-]+/g, "_");
  // Nested public_id under preset folder (loyalty-cards) → loyalty-cards/invoices/...
  const publicId = `invoices/${safeInvoice}-${Date.now()}`;
  let uploaded;
  try {
    // Pass the capture blob through unchanged — no re-encode / quality change.
    uploaded = await uploadBlobToCloudinary(opts.blob, {
      resourceType: "image",
      publicId,
      filename: `${safeInvoice}.jpg`,
    });
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Cloudinary upload failed" };
  }

  return enqueueWhatsAppConsoleMessage({
    kind: "invoice",
    phone,
    patient_name: opts.patient_name,
    registration_id: opts.registration_id,
    invoice_number: invoiceNumber,
    caption: opts.caption,
    media_url: uploaded.secure_url,
    media_mime: "image/jpeg",
    max_attempts: 1,
    payload: {
      media_host: "cloudinary",
      cloudinary_cloud_name: uploaded.cloud_name,
      cloudinary_public_id: uploaded.public_id,
      cloudinary_resource_type: uploaded.resource_type,
      cloudinary_folder: `${WA_MEDIA_FOLDER_ROOT}/invoices`,
    },
  });
}

/** Upload report PDF to Cloudinary (bytes unchanged) and enqueue for Console delivery.
 * Requires Cloudinary Security → “Allow delivery of PDF and ZIP files” (Free accounts
 * upload PDFs fine but block public delivery with 401 until that is enabled).
 *
 * Cloudinary Free caps uploads at 10 MB. Large multi-page reports (e.g. PH6) are
 * split into multiple PDF parts under that limit — page quality is unchanged
 * (pdf-lib copyPages only; no JPEG re-encode).
 */
export async function enqueueReportForWhatsAppConsole(opts: {
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number: string;
  caption: string;
  blob: Blob;
  filename?: string;
}): Promise<{ ok: boolean; id?: string; error?: string; partCount?: number }> {
  const phone = phone10(opts.phone);
  if (phone.length !== 10) return { ok: false, error: "Valid 10-digit mobile required" };

  const safeInvoice = String(opts.invoice_number || "report").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const rawName = opts.filename || `${opts.invoice_number || "report"} report.pdf`;
  const baseName = String(rawName)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "");
  const folderHint = `${WA_MEDIA_FOLDER_ROOT}/reports`;
  const stamp = Date.now();

  let parts: Blob[];
  try {
    parts = await splitPdfBlobUnderMaxBytes(opts.blob, CLOUDINARY_SAFE_UPLOAD_BYTES);
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Failed to prepare report PDF for upload" };
  }
  if (!parts.length) return { ok: false, error: "Empty report PDF" };

  const isFileTooLarge = (msg: string) =>
    /file size too large|maximum.*size|entity too large|413/i.test(msg);

  let firstId: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const partNo = i + 1;
    const multi = parts.length > 1;
    const filename = multi
      ? `${baseName} part ${partNo} of ${parts.length}.pdf`
      : `${baseName}.pdf`;
    const caption = multi
      ? `${opts.caption}\n\n_Report PDF — Part ${partNo} of ${parts.length}_`
      : opts.caption;
    const publicId = multi
      ? `reports/${safeInvoice}-${stamp}-p${partNo}`
      : `reports/${safeInvoice}-${stamp}`;

    let uploaded;
    try {
      // auto keeps original PDF bytes; no re-encode / quality change.
      uploaded = await uploadBlobToCloudinary(parts[i], {
        resourceType: "auto",
        publicId,
        filename,
      });
    } catch (e) {
      const msg = (e as Error)?.message || "Cloudinary upload failed";
      // If Cloudinary still rejects (limit / plan), surface a clear message.
      if (isFileTooLarge(msg)) {
        return {
          ok: false,
          error:
            multi
              ? `Report part ${partNo}/${parts.length} still exceeds Cloudinary upload limit (${msg})`
              : `Report PDF too large for Cloudinary upload (${msg}). Try again after refresh.`,
          partCount: parts.length,
        };
      }
      return { ok: false, error: msg, partCount: parts.length };
    }

    // Prefer a .pdf delivery URL so WhatsApp Console sniffs the document correctly.
    let mediaUrl = uploaded.secure_url;
    if (!/\.pdf(\?|$)/i.test(mediaUrl)) {
      mediaUrl = mediaUrl.includes("?")
        ? mediaUrl.replace(/(\?)/, ".pdf$1")
        : `${mediaUrl}.pdf`;
    }

    const queued = await enqueueWhatsAppConsoleMessage({
      kind: "report",
      phone,
      patient_name: opts.patient_name,
      registration_id: opts.registration_id,
      invoice_number: opts.invoice_number,
      caption,
      media_url: mediaUrl,
      media_mime: "application/pdf",
      payload: {
        media_host: "cloudinary",
        cloudinary_cloud_name: uploaded.cloud_name,
        cloudinary_public_id: uploaded.public_id,
        cloudinary_resource_type: uploaded.resource_type,
        cloudinary_folder: folderHint,
        filename,
        report_part: multi ? partNo : 1,
        report_parts_total: parts.length,
      },
    });
    if (!queued.ok) {
      return {
        ok: false,
        error: queued.error || `Failed to queue report part ${partNo}`,
        partCount: parts.length,
        id: firstId,
      };
    }
    if (!firstId) firstId = queued.id;
  }

  return { ok: true, id: firstId, partCount: parts.length };
}
