import { corsHeaders } from "../_shared/cors.ts";
import { loadR2Config, presignR2Put, sanitizeReportKeyPart } from "../_shared/r2.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function serviceConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (Deno.env.get("REPORT_PDF_SERVICE_URL") || "").trim().replace(/\/+$/, "");
  const apiKey = (Deno.env.get("REPORT_PDF_SERVICE_KEY") || "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body?.action || "status").trim().toLowerCase();
  const svc = serviceConfig();

  if (action === "status") {
    return json({
      ok: true,
      configured: Boolean(svc),
      hasR2: Boolean(loadR2Config()),
    });
  }

  if (!svc) {
    return json(
      {
        error:
          "Chromium PDF service is not configured. Set REPORT_PDF_SERVICE_URL and REPORT_PDF_SERVICE_KEY, or switch Report PDF engine back to Screen JPEG.",
      },
      503,
    );
  }

  if (action === "presign_html") {
    const cfg = loadR2Config();
    if (!cfg) {
      return json({ error: "R2 is required to stage large report HTML. Configure R2 secrets." }, 503);
    }
    const stamp = Date.now();
    const key = `tmp-report-html/${sanitizeReportKeyPart(String(stamp), "html")}_${stamp}.html`;
    try {
      const signed = await presignR2Put(cfg, key, "text/html; charset=utf-8", 900);
      return json({ ok: true, ...signed });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (action === "render") {
    const htmlUrl = String(body?.html_url || "").trim();
    const html = typeof body?.html === "string" ? body.html : "";
    if (!htmlUrl && !html) {
      return json({ error: "html or html_url required" }, 400);
    }
    try {
      const upstream = await fetch(`${svc.baseUrl}/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": svc.apiKey,
        },
        body: JSON.stringify({
          html_url: htmlUrl || undefined,
          html: htmlUrl ? undefined : html,
        }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        return json(
          {
            error: `PDF service HTTP ${upstream.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`,
          },
          502,
        );
      }
      const ct = upstream.headers.get("content-type") || "";
      if (ct.includes("application/pdf")) {
        const buf = new Uint8Array(await upstream.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode(...buf.subarray(i, i + chunk));
        }
        return json({ ok: true, pdf_base64: btoa(binary), bytes: buf.length });
      }
      const parsed = await upstream.json().catch(() => null) as {
        pdf_base64?: string;
        error?: string;
        bytes?: number;
      } | null;
      if (parsed?.pdf_base64) {
        return json({ ok: true, pdf_base64: parsed.pdf_base64, bytes: parsed.bytes });
      }
      return json({ error: parsed?.error || "PDF service returned no PDF" }, 502);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return json({ error: "Unknown action" }, 400);
});