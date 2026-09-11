import { corsHeaders } from "../_shared/cors.ts";
import {
  deleteR2Object,
  loadR2Config,
  presignR2Put,
  sanitizeReportKeyPart,
} from "../_shared/r2.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const cfg = loadR2Config();
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body?.action || "presign").trim().toLowerCase();

  if (action === "status") {
    return json({
      ok: true,
      configured: Boolean(cfg),
      bucket: cfg?.bucket || null,
      publicBaseUrl: cfg?.publicBaseUrl || null,
    });
  }

  if (!cfg) {
    return json(
      {
        error:
          "R2 is not configured. Set edge secrets R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL.",
      },
      503,
    );
  }

  if (action === "presign") {
    const invoice = sanitizeReportKeyPart(body?.invoice_number || body?.invoice || "report");
    const filenameRaw = String(body?.filename || `${invoice} report.pdf`);
    const safeName =
      sanitizeReportKeyPart(filenameRaw.replace(/\.pdf$/i, ""), invoice) + ".pdf";
    const key = `wa-reports/${invoice}/${Date.now()}_${safeName}`;
    const contentType = String(body?.content_type || "application/pdf");
    try {
      const signed = await presignR2Put(cfg, key, contentType, 900);
      return json({ ok: true, ...signed, filename: safeName });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (action === "delete") {
    const key = String(body?.key || body?.r2_key || "").trim();
    if (!key.startsWith("wa-reports/")) {
      return json({ error: "invalid_r2_key" }, 400);
    }
    try {
      const ok = await deleteR2Object(cfg, key);
      return json({ ok });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return json({ error: "Unknown action" }, 400);
});