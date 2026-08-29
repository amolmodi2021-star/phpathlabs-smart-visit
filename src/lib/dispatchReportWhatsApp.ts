import { createShareLink } from "@/lib/reportShareLinks";
import { enqueueReportForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";
import { getCachedReportPdf, reportPdfCacheKey } from "@/lib/reportPdfSessionCache";

/** Open report viewer and download the PDF (no WhatsApp). */
export function openReportForManualWhatsApp(opts: {
  registrationId: string;
  testIds: string[];
  pendingReportNames?: string[];
}): { ok: boolean; error?: string } {
  const tests = opts.testIds.filter(Boolean).join(",");
  if (!opts.registrationId || !tests) {
    return { ok: false, error: "No reports available to download" };
  }
  // Unique name every time — a reused named window often focuses without reloading.
  const url = `/lims/report/${opts.registrationId}?tests=${encodeURIComponent(tests)}&manualWa=1`;
  // Smaller popup; do not steal focus from Dispatch while PDF builds.
  const win = window.open(
    url,
    `lims-report-manual-wa-${Date.now()}`,
    "popup=yes,width=720,height=540,left=80,top=80",
  );
  if (!win) {
    return { ok: false, error: "Popup blocked — allow popups to download the report PDF" };
  }
  return { ok: true };
}

async function buildReportCaption(opts: {
  registrationId: string;
  invoiceNumber: string;
  patientName: string;
  pendingReportNames?: string[];
}): Promise<string> {
  const pending = (opts.pendingReportNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  const pendingLine = pending.length
    ? `Pending Reports : ${pending.join(", ")}`
    : "No Reports Pending";
  let portalLine = "";
  try {
    const created = await createShareLink(opts.registrationId, opts.invoiceNumber, "dispatch");
    portalLine = `\nView online: ${created.url}`;
  } catch (e) {
    console.warn("share link for report caption failed", e);
  }
  return (
    `*PH PathLabs — Lab Report*\n` +
    `Invoice No: ${opts.invoiceNumber}\n` +
    `Patient: ${opts.patientName}\n` +
    `Your lab reports are ready.\n` +
    `${pendingLine}` +
    portalLine +
    `\n\nThank you for choosing PH PathLabs.\nLabLine: 6356 55 66 99`
  );
}

/**
 * If a session-cached PDF exists for this registration+tests, enqueue WhatsApp
 * immediately (no popup / no re-raster). Returns null when cache miss.
 */
export async function tryQueueCachedReportWhatsApp(opts: {
  registrationId: string;
  testIds: string[];
  phone: string;
  patientName?: string | null;
  invoiceNumber?: string | null;
  pendingReportNames?: string[];
}): Promise<{ ok: boolean; error?: string; fromCache: true } | null> {
  const key = reportPdfCacheKey(opts.registrationId, opts.testIds);
  const cached = await getCachedReportPdf(key);
  if (!cached) return null;

  const invoice = String(opts.invoiceNumber || "report");
  const caption = await buildReportCaption({
    registrationId: opts.registrationId,
    invoiceNumber: invoice,
    patientName: opts.patientName || "Patient",
    pendingReportNames: opts.pendingReportNames,
  });
  const res = await enqueueReportForWhatsAppConsole({
    phone: opts.phone,
    patient_name: opts.patientName,
    registration_id: opts.registrationId,
    invoice_number: invoice,
    caption,
    blob: cached.blob,
    filename: cached.filename,
  });
  if (!res.ok) return { ok: false, error: res.error || "Failed to queue report WhatsApp", fromCache: true };
  return { ok: true, fromCache: true };
}

/** Open report viewer to generate PDF and queue WhatsApp Console delivery. */
export function queueApprovedReportWhatsApp(opts: {
  registrationId: string;
  testIds: string[];
  /** Test names still not approved/dispatched — shown in caption. */
  pendingReportNames?: string[];
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const tests = opts.testIds.filter(Boolean).join(",");
  if (!opts.registrationId || !tests) {
    return Promise.resolve({ ok: false, error: "No approved tests to send" });
  }

  return new Promise((resolve) => {
    const pending = (opts.pendingReportNames || []).map((n) => String(n || "").trim()).filter(Boolean);
    const pendingQ = `&pendingReports=${encodeURIComponent(pending.join(", "))}`;
    const url =
      `/lims/report/${opts.registrationId}?tests=${encodeURIComponent(tests)}&queueWa=1${pendingQ}`;
    // Unique name: reusing "lims-report-wa-queue" left a hung blank tab that never reloaded.
    // Do not focus — keep staff on Dispatch while the background popup builds the PDF.
    const win = window.open(
      url,
      `lims-report-wa-queue-${Date.now()}`,
      "popup=yes,width=720,height=540,left=80,top=80",
    );
    if (!win) {
      resolve({
        ok: false,
        error: "Popup blocked — allow popups so Dispatch All can queue the report PDF",
      });
      return;
    }

    let settled = false;
    const timeoutMs = opts.timeoutMs ?? 360_000;
    const timeout = window.setTimeout(() => {
      finish({ ok: false, error: "Timed out generating report PDF for WhatsApp" });
    }, timeoutMs);

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || data.type !== "lims-report-wa-queue") return;
      if (data.registrationId !== opts.registrationId) return;
      finish({
        ok: !!data.ok,
        error: data.ok ? undefined : String(data.error || "Failed to queue report WhatsApp"),
      });
    };

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMsg);
      try {
        if (!win.closed) win.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    window.addEventListener("message", onMsg);
  });
}
