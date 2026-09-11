import { supabase } from "@/integrations/supabase/client";

export type R2PresignResult = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  filename: string;
  expiresIn: number;
};

/** Ask edge for a short-lived R2 PUT URL, then upload PDF bytes from the browser. */
export async function uploadReportPdfToR2(opts: {
  blob: Blob;
  filename: string;
  invoice_number: string;
}): Promise<
  | { ok: true; publicUrl: string; key: string; filename: string; bytes: number }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.functions.invoke("r2-report-media", {
    body: {
      action: "presign",
      filename: opts.filename,
      invoice_number: opts.invoice_number,
      content_type: "application/pdf",
    },
  });

  if (error) {
    return { ok: false, error: error.message || "R2 presign failed" };
  }
  const body = data as
    | (R2PresignResult & { ok?: boolean; error?: string })
    | null;
  if (!body?.uploadUrl || !body?.publicUrl || !body?.key) {
    return {
      ok: false,
      error: body?.error || "R2 is not configured or presign returned no URL",
    };
  }

  let putRes: Response;
  try {
    putRes = await fetch(body.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: opts.blob,
    });
  } catch (e) {
    return {
      ok: false,
      error: `R2 upload network error: ${(e as Error)?.message || e}`,
    };
  }

  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => "");
    return {
      ok: false,
      error: `R2 upload HTTP ${putRes.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`,
    };
  }

  return {
    ok: true,
    publicUrl: body.publicUrl,
    key: body.key,
    filename: body.filename || opts.filename,
    bytes: opts.blob.size,
  };
}

export async function getR2ReportStatus(): Promise<{
  configured: boolean;
  bucket: string | null;
  publicBaseUrl: string | null;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("r2-report-media", {
    body: { action: "status" },
  });
  if (error) return { configured: false, bucket: null, publicBaseUrl: null, error: error.message };
  const body = data as {
    configured?: boolean;
    bucket?: string | null;
    publicBaseUrl?: string | null;
  } | null;
  return {
    configured: Boolean(body?.configured),
    bucket: body?.bucket ?? null,
    publicBaseUrl: body?.publicBaseUrl ?? null,
  };
}