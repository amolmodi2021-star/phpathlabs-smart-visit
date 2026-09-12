import { getCachedReportFontEmbedCSS, REPORT_CAPTURE_FONT } from "@/lib/htmlCaptureFonts";

const PAGE_W = "210mm";
const PAGE_H = "297mm";

/**
 * Collect CSS from the live document so Chromium PDF matches on-screen Tailwind/grids/colors.
 */
async function collectDocumentCss(): Promise<string> {
  const chunks: string[] = [];
  const nodes = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
  for (const node of nodes) {
    if (node instanceof HTMLStyleElement) {
      const t = node.textContent || "";
      if (t.trim()) chunks.push(t);
      continue;
    }
    if (node instanceof HTMLLinkElement && node.href) {
      try {
        const res = await fetch(node.href, { credentials: "same-origin" });
        if (res.ok) chunks.push(await res.text());
      } catch {
        /* cross-origin sheet — skip */
      }
    }
  }
  return chunks.join("\n");
}

function clonePagesForPrint(printRoot: HTMLElement): string {
  const pageEls = Array.from(printRoot.querySelectorAll("[data-page]")) as HTMLElement[];
  const parts: string[] = [];
  for (const page of pageEls) {
    const clone = page.cloneNode(true) as HTMLElement;
    // Match on-screen page: drop preview-only scale; keep colors/letterhead/grids as rendered.
    clone.style.transform = "none";
    clone.style.transformOrigin = "";
    clone.style.width = PAGE_W;
    clone.style.height = PAGE_H;
    clone.style.minHeight = PAGE_H;
    clone.style.maxHeight = PAGE_H;
    clone.style.boxShadow = "none";
    clone.style.margin = "0";
    clone.style.overflow = "hidden";
    clone.style.fontFamily = REPORT_CAPTURE_FONT;
    clone.setAttribute("style", clone.getAttribute("style") || "");
    parts.push(`<div class="pdf-page-shell">${clone.outerHTML}</div>`);
  }
  return parts.join("\n");
}

const PRINT_CHROME_CSS = `
@page { size: A4; margin: 0; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
  font-family: ${REPORT_CAPTURE_FONT};
}
.pdf-root {
  margin: 0;
  padding: 0;
  background: #fff;
}
.pdf-page-shell {
  width: ${PAGE_W};
  height: ${PAGE_H};
  margin: 0;
  padding: 0;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.pdf-page-shell:last-child {
  page-break-after: auto;
  break-after: auto;
}
.pdf-page-shell [data-page] {
  box-shadow: none !important;
  transform: none !important;
  width: ${PAGE_W} !important;
  height: ${PAGE_H} !important;
  min-height: ${PAGE_H} !important;
  max-height: ${PAGE_H} !important;
  overflow: hidden !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
`;

/**
 * Build a self-contained HTML document that mirrors the on-screen report
 * (grids, margins, letterhead, colors, snip images). Used by Chromium page.pdf().
 */
export async function buildReportPrintHtmlDocument(printRoot: HTMLElement): Promise<string> {
  const [fontCss, docCss] = await Promise.all([
    getCachedReportFontEmbedCSS(printRoot),
    collectDocumentCss(),
  ]);
  const bodyHtml = clonePagesForPrint(printRoot);
  if (!bodyHtml.trim()) {
    throw new Error("No report pages to convert to PDF");
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>LIMS Report</title>
<style>${fontCss}\n${docCss}\n${PRINT_CHROME_CSS}</style>
</head>
<body>
<div class="pdf-root" id="print-container">${bodyHtml}</div>
</body>
</html>`;
}