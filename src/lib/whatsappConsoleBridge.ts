import { supabase } from "@/integrations/supabase/client";
import { uploadBlobToCloudinary } from "@/lib/cardStorageCloudinary";

/** Cloudinary Free max image/raw upload is 10 MB — stay under with headroom. */
const CLOUDINARY_SAFE_UPLOAD_BYTES = 9 * 1024 * 1024;

/** Same token as WhatsApp Console / PHPL Reception local data API. */
const LOCAL_LIMS_MEDIA_TOKEN = "phpathlabs-local-media";

/** Localhost ports used by Console / Reception local data API (only one binds). */
const LOCAL_DESKTOP_MEDIA_PORTS = [37821];

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

type LocalStashResult = {
  local_media_id: string;
  filename: string;
  bytes: number;
  port: number;
};

/**
 * Hand oversized report PDF bytes to WhatsApp Console / PHPL Reception on this PC
 * (localhost). No Cloudinary / Supabase Storage — Console then sends from disk.
 */
async function stashReportPdfOnLocalDesktop(opts: {
  blob: Blob;
  filename: string;
  invoice_number: string;
  phone: string;
}): Promise<{ ok: true; data: LocalStashResult } | { ok: false; error: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "X-Lims-Local-Token": LOCAL_LIMS_MEDIA_TOKEN,
    "X-Filename": opts.filename,
    "X-Invoice": opts.invoice_number || "",
    "X-Phone": opts.phone,
  };

  let lastErr = "WhatsApp Console / PHPL Reception is not reachable on this PC";
  for (const port of LOCAL_DESKTOP_MEDIA_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const healthCtrl = new AbortController();
      const healthTimer = window.setTimeout(() => healthCtrl.abort(), 900);
      const health = await fetch(`${base}/health`, {
        method: "GET",
        signal: healthCtrl.signal,
      });
      window.clearTimeout(healthTimer);
      if (!health.ok) {
        lastErr = `Local desktop API health HTTP ${health.status}`;
        continue;
      }
      const healthJson = (await health.json().catch(() => null)) as { limsMedia?: boolean } | null;
      if (healthJson && healthJson.limsMedia === false) {
        lastErr = "Local desktop API is running but lims-media is not enabled — update Console/Reception";
        continue;
      }

      const postCtrl = new AbortController();
      const postTimer = window.setTimeout(() => postCtrl.abort(), 120_000);
      const res = await fetch(`${base}/api/lims-media`, {
        method: "POST",
        headers,
        body: opts.blob,
        signal: postCtrl.signal,
      });
      window.clearTimeout(postTimer);
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; local_media_id?: string; filename?: string; bytes?: number; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.local_media_id) {
        lastErr = json?.error || `Local media stash HTTP ${res.status}`;
        continue;
      }
      return {
        ok: true,
        data: {
          local_media_id: String(json.local_media_id),
          filename: String(json.filename || opts.filename),
          bytes: Number(json.bytes) || opts.blob.size,
          port,
        },
      };
    } catch (e) {
      const msg = (e as Error)?.name === "AbortError" ? "local_desktop_timeout" : (e as Error)?.message || String(e);
      lastErr = msg;
    }
  }

  return {
    ok: false,
    error:
      `Large report PDF (${(opts.blob.size / (1024 * 1024)).toFixed(1)} MB) needs WhatsApp Console or PHPL Reception open on this same PC. ${lastErr}`,
  };
}

/** Upload report PDF and enqueue for Console delivery (single file — never split).
 * Prefer Cloudinary when under Free-plan ~10 MB. Oversized PDFs hand off to
 * WhatsApp Console / PHPL Reception on this PC (localhost) — same quality, no cloud host.
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

  const safeInvoice = String(opts.invoice_number || "report").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const rawName = opts.filename || `${opts.invoice_number || "report"} report.pdf`;
  const filename =
    String(rawName)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.pdf$/i, "") + ".pdf";
  const folderHint = `${WA_MEDIA_FOLDER_ROOT}/reports`;
  const publicId = `reports/${safeInvoice}-${Date.now()}`;
  const isFileTooLarge = (msg: string) =>
    /file size too large|maximum.*size|entity too large|413/i.test(msg);

  let mediaUrl: string | null = null;
  let payload: Record<string, unknown> = {};

  const tryCloudinary = opts.blob.size <= CLOUDINARY_SAFE_UPLOAD_BYTES;
  if (tryCloudinary) {
    try {
      const uploaded = await uploadBlobToCloudinary(opts.blob, {
        resourceType: "auto",
        publicId,
        filename,
      });
      mediaUrl = uploaded.secure_url;
      if (!/\.pdf(\?|$)/i.test(mediaUrl)) {
        mediaUrl = mediaUrl.includes("?")
          ? mediaUrl.replace(/(\?)/, ".pdf$1")
          : `${mediaUrl}.pdf`;
      }
      payload = {
        media_host: "cloudinary",
        cloudinary_cloud_name: uploaded.cloud_name,
        cloudinary_public_id: uploaded.public_id,
        cloudinary_resource_type: uploaded.resource_type,
        cloudinary_folder: folderHint,
        filename,
      };
    } catch (e) {
      const msg = (e as Error)?.message || "Cloudinary upload failed";
      if (!isFileTooLarge(msg)) {
        return { ok: false, error: msg };
      }
      // fall through to same-PC local stash
    }
  }

  if (!mediaUrl) {
    const stashed = await stashReportPdfOnLocalDesktop({
      blob: opts.blob,
      filename,
      invoice_number: opts.invoice_number,
      phone,
    });
    if (!stashed.ok) return { ok: false, error: stashed.error };
    payload = {
      media_host: "local_desktop",
      local_media_id: stashed.data.local_media_id,
      filename: stashed.data.filename,
      bytes: stashed.data.bytes,
      local_port: stashed.data.port,
    };
  }

  return enqueueWhatsAppConsoleMessage({
    kind: "report",
    phone,
    patient_name: opts.patient_name,
    registration_id: opts.registration_id,
    invoice_number: opts.invoice_number,
    caption: opts.caption,
    media_url: mediaUrl,
    media_mime: "application/pdf",
    payload,
  });
}
