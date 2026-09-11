import { supabase } from "@/integrations/supabase/client";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";
import { uploadReportPdfToR2 } from "@/lib/reportStorageR2";

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
  const publicId = `invoices/${safeInvoice}-${Date.now()}`;
  let uploaded;
  try {
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

/**
 * Upload report PDF to Cloudflare R2 (no Cloudinary 10 MB limit) and enqueue
 * for Console delivery. Invoices and other WhatsApp media stay on Cloudinary.
 */
export async function enqueueReportForWhatsAppConsole(opts: {
  phone: string;
  patient_name?: string | null;
  registration_id?: string | null;
  invoice_number: string;
  caption: string;
  blob: Blob;
  filename?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const phone = phone10(opts.phone);
  if (phone.length !== 10) return { ok: false, error: "Valid 10-digit mobile required" };

  const rawName = opts.filename || `${opts.invoice_number || "report"} report.pdf`;
  const filename =
    String(rawName)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.pdf$/i, "") + ".pdf";

  const uploaded = await uploadReportPdfToR2({
    blob: opts.blob,
    filename,
    invoice_number: opts.invoice_number,
  });
  if (!uploaded.ok) {
    return { ok: false, error: uploaded.error };
  }

  return enqueueWhatsAppConsoleMessage({
    kind: "report",
    phone,
    patient_name: opts.patient_name,
    registration_id: opts.registration_id,
    invoice_number: opts.invoice_number,
    caption: opts.caption,
    media_url: uploaded.publicUrl,
    media_mime: "application/pdf",
    payload: {
      media_host: "r2",
      r2_key: uploaded.key,
      filename: uploaded.filename,
      bytes: uploaded.bytes,
    },
  });
}