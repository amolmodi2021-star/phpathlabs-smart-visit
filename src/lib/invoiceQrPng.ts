import QRCode from "qrcode";

/** Render a report-portal URL as a PNG data URL for invoice capture/print. */
export async function renderInvoiceQrPng(url: string, sizePx = 120): Promise<string> {
  if (!url) return "";
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: sizePx,
      color: { dark: "#111827", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}