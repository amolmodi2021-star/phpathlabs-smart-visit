/**
 * Chromium print-to-PDF for PH PathLabs LIMS reports.
 * Expects self-contained HTML that mirrors on-screen View Report (grids/colors/snips).
 *
 * Env:
 *   PORT (default 3791)
 *   REPORT_PDF_SERVICE_KEY (required) — shared secret from edge
 */
import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 3791);
const API_KEY = String(process.env.REPORT_PDF_SERVICE_KEY || "").trim();

if (!API_KEY) {
  console.error("REPORT_PDF_SERVICE_KEY is required");
  process.exit(1);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function waitForImages(page) {
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images || []);
    if (!imgs.length) return true;
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 60_000 });
}

async function renderPdf({ html, html_url }) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--font-render-hinting=none", "--disable-lcd-text"],
    });
    const page = await browser.newPage();
    // Exact A4 CSS pixels at 96dpi — matches LimsReportView NATIVE size.
    await page.setViewportSize({ width: 794, height: 1123 });

    if (html_url) {
      await page.goto(html_url, { waitUntil: "networkidle", timeout: 90_000 });
    } else {
      await page.setContent(String(html || ""), {
        waitUntil: "networkidle",
        timeout: 90_000,
      });
    }

    await waitForImages(page);
    // Extra beat for webfonts / late layout
    await page.waitForTimeout(250);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return pdf;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/render") {
    const key = String(req.headers["x-api-key"] || "");
    if (key !== API_KEY) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readJson(req);
      const pdf = await renderPdf({
        html: body.html,
        html_url: body.html_url,
      });
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.length,
      });
      res.end(pdf);
    } catch (e) {
      console.error("render failed", e);
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`PHPL report-pdf listening on :${PORT}`);
});