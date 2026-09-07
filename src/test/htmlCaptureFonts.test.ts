import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getFontEmbedCSS = vi.fn();

vi.mock("html-to-image", () => ({
  getFontEmbedCSS: (...args: unknown[]) => getFontEmbedCSS(...args),
}));

import {
  getCachedReportFontEmbedCSS,
  REPORT_CAPTURE_FONT,
  reportCaptureStyle,
  resetReportFontEmbedCache,
} from "@/lib/htmlCaptureFonts";

describe("htmlCaptureFonts", () => {
  beforeEach(() => {
    resetReportFontEmbedCache();
    getFontEmbedCSS.mockReset();
    getFontEmbedCSS.mockResolvedValue("@font-face{font-family:'Noto Sans'}");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (href: string) => {
        expect(String(href)).toMatch(/\/fonts\/ibm-plex-sans-latin-\d{3}-normal\.woff2$/);
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer,
        };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetReportFontEmbedCache();
  });

  it("quotes IBM Plex Sans so SVG capture does not split the family name", () => {
    expect(REPORT_CAPTURE_FONT).toContain('"IBM Plex Sans"');
    expect(reportCaptureStyle({ transform: "none" })).toEqual({
      fontFamily: REPORT_CAPTURE_FONT,
      transform: "none",
    });
  });

  it("embeds local IBM Plex woff2 as data URIs and caches the CSS", async () => {
    const node = document.createElement("div");
    const css = await getCachedReportFontEmbedCSS(node);
    expect(css).toContain("font-family:'IBM Plex Sans'");
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain("font-weight:400");
    expect(css).toContain("font-weight:700");
    expect(css).toContain("Noto Sans");
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(5);

    const again = await getCachedReportFontEmbedCSS(node);
    expect(again).toBe(css);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});

describe("report capture wiring", () => {
  it("embeds fonts on structured PDF/WhatsApp capture instead of skipFonts", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/pages/LimsReportView.tsx"),
      "utf8",
    );
    expect(source).toContain("getCachedReportFontEmbedCSS");
    expect(source).toContain("fontEmbedCSS");
    expect(source).toContain("REPORT_CAPTURE_FONT");
    expect(source).not.toMatch(/skipFonts:\s*true/);
    expect(source).toContain("captureOpts?.skipFonts ?? isSnipPage");
  });

  it("ships same-origin IBM Plex files for capture embed", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain("/fonts/ibm-plex-sans-latin-400-normal.woff2");
    for (const weight of [300, 400, 500, 600, 700]) {
      const file = path.resolve(
        process.cwd(),
        `public/fonts/ibm-plex-sans-latin-${weight}-normal.woff2`,
      );
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(1000);
    }
  });
});
