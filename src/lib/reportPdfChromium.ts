import { supabase } from "@/integrations/supabase/client";

export type ChromiumPdfStatus = {
  configured: boolean;
  error?: string;
};

export async function getChromiumPdfStatus(): Promise<ChromiumPdfStatus> {
  const { data, error } = await supabase.functions.invoke("report-pdf-render", {
    body: { action: "status" },
  });
  if (error) return { configured: false, error: error.message };
  const body = data as { configured?: boolean; error?: string } | null;
  return {
    configured: Boolean(body?.configured),
    error: body?.error,
  };
}

/**
 * Render print-ready HTML via edge → Playwright Chromium (vector text + embedded snips).
 * Large HTML is staged to R2 first so Edge body limits are not hit.
 */
export async function renderReportPdfViaChromium(html: string): Promise<Blob> {
  const bytes = new TextEncoder().encode(html).length;
  let body: Record<string, unknown>;

  if (bytes > 3_500_000) {
    const { data: pre, error: preErr } = await supabase.functions.invoke("report-pdf-render", {
      body: {
        action: "presign_html",
        content_type: "text/html; charset=utf-8",
      },
    });
    if (preErr) throw new Error(preErr.message || "HTML presign failed");
    const signed = pre as {
      uploadUrl?: string;
      publicUrl?: string;
      key?: string;
      error?: string;
    } | null;
    if (!signed?.uploadUrl || !signed?.publicUrl) {
      throw new Error(signed?.error || "Chromium PDF HTML staging is not configured");
    }
    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => "");
      throw new Error(`HTML upload HTTP ${put.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
    }
    body = { action: "render", html_url: signed.publicUrl, html_key: signed.key };
  } else {
    body = { action: "render", html };
  }

  const { data, error } = await supabase.functions.invoke("report-pdf-render", { body });
  if (error) throw new Error(error.message || "Chromium PDF render failed");
  const res = data as {
    ok?: boolean;
    pdf_base64?: string;
    error?: string;
    bytes?: number;
  } | null;
  if (!res?.pdf_base64) {
    throw new Error(res?.error || "Chromium PDF returned no data");
  }
  const bin = Uint8Array.from(atob(res.pdf_base64), (c) => c.charCodeAt(0));
  return new Blob([bin], { type: "application/pdf" });
}