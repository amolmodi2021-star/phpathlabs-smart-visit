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
  const url = `/lims/report/${opts.registrationId}?tests=${encodeURIComponent(tests)}&manualWa=1`;
  const win = window.open(url, "lims-report-manual-wa", "width=960,height=720");
  if (!win) {
    return { ok: false, error: "Popup blocked — allow popups to download the report PDF" };
  }
  return { ok: true };
}

/** Open report viewer to generate PDF and queue WhatsApp Console delivery. */
export function queueApprovedReportWhatsApp(opts: {
  registrationId: string;
  testIds: string[];
  /** Test names still not approved/dispatched ? shown in caption. */
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
    const win = window.open(url, "lims-report-wa-queue", "width=960,height=720");
    if (!win) {
      resolve({
        ok: false,
        error: "Popup blocked ? allow popups so Dispatch All can queue the report PDF",
      });
      return;
    }

    let settled = false;
    const timeoutMs = opts.timeoutMs ?? 120_000;
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
