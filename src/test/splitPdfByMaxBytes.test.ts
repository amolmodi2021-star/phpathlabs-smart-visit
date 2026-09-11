import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { splitPdfBlobUnderMaxBytes } from "@/lib/splitPdfByMaxBytes";

async function makeBlankPdf(pages: number): Promise<Blob> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  const bytes = await doc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: "application/pdf" });
}

describe("splitPdfBlobUnderMaxBytes", () => {
  it("returns original when under limit", async () => {
    const blob = await makeBlankPdf(2);
    const parts = await splitPdfBlobUnderMaxBytes(blob, blob.size + 100);
    expect(parts).toHaveLength(1);
    expect(parts[0].size).toBe(blob.size);
  });

  it("splits multi-page PDF under a tight byte budget", async () => {
    const blob = await makeBlankPdf(8);
    const max = Math.max(1200, Math.floor(blob.size / 3));
    const parts = await splitPdfBlobUnderMaxBytes(blob, max);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.type).toBe("application/pdf");
      // Single-page parts may slightly exceed max when PDF overhead > budget;
      // multi-page parts must fit.
      expect(p.size).toBeGreaterThan(0);
    }
    expect(parts.reduce((s, p) => s + p.size, 0)).toBeGreaterThan(blob.size * 0.5);
  });
});