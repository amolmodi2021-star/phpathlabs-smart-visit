// @vitest-environment node
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import {
  histogramPlotY,
  histogramScaleForKind,
  isInteriorDiscriminator,
  XP_HISTOGRAM_SCALE,
} from "@/lib/histogramPlotX";

describe("histogramPlotX", () => {
  it("auto-scales Y so the data peak stays inside the plot frame", () => {
    const plotTop = 22;
    const plotBottom = 194;
    const peak = 255;
    const yPeak = histogramPlotY({ value: peak, peak, plotTop, plotBottom });
    const yZero = histogramPlotY({ value: 0, peak, plotTop, plotBottom });
    const yHalf = histogramPlotY({ value: peak / 2, peak, plotTop, plotBottom });
    expect(yZero).toBe(plotBottom);
    expect(yPeak).toBeGreaterThan(plotTop + 30);
    expect(yPeak).toBeLessThan(plotBottom);
    expect(yHalf).toBeGreaterThan(yPeak);
    expect(yHalf).toBeLessThan(yZero);
  });

  it("maps fL to pixel on a 0–40 PLT axis with 40 unlabeled", () => {
    const scale = histogramScaleForKind("PLT", 40, 10, 400);
    expect(XP_HISTOGRAM_SCALE.PLT.xMax).toBe(40);
    expect(XP_HISTOGRAM_SCALE.PLT.ticks).toEqual([0, 10, 20, 30]);
    expect(scale.plotX(0)).toBe(10);
    expect(scale.plotX(10)).toBe(110);
    expect(scale.plotX(20)).toBe(210);
    expect(scale.plotX(30)).toBe(310);
    expect(scale.plotX(40)).toBe(410);
  });

  it("sample 2608180015: WBC discs 6/13/19/49 sit at 42/84/120/300 fL", () => {
    const scale = histogramScaleForKind("WBC", 50, 10, 300);
    expect(scale.originFl).toBe(6);
    expect(scale.channelToFl(6)).toBe(42);
    expect(scale.channelToFl(13)).toBe(84);
    expect(scale.channelToFl(19)).toBe(120);
    expect(scale.channelToFl(49)).toBe(300);
    expect(scale.plotX(scale.channelToFl(49))).toBe(scale.plotX(300));
    expect(isInteriorDiscriminator(300, scale)).toBe(true);
  });

  it("sample 2608180022: PLT disc 29 sits on 30 fL and on curve bin 29", () => {
    const scale = histogramScaleForKind("PLT", 40, 10, 400);
    expect(scale.originFl).toBe(1);
    expect(scale.channelToFl(29)).toBe(30);
    expect(scale.plotX(scale.channelToFl(29))).toBe(scale.plotX(30));
    expect(scale.plotX(30)).toBe(310);
    expect(isInteriorDiscriminator(30, scale)).toBe(true);
  });

  it("PLT: 1-based 1 fL/channel; last bin reaches 40; peak bin 8 is 9 fL", () => {
    const scale = histogramScaleForKind("PLT", 40, 28, 540);
    expect(scale.flPerChannel).toBe(1);
    expect(scale.channelToFl(0)).toBe(1);
    expect(scale.channelToFl(1)).toBe(2);
    expect(scale.channelToFl(8)).toBe(9);
    expect(scale.channelToFl(29)).toBe(30);
    expect(scale.channelToFl(39)).toBe(40);
    expect(scale.plotX(scale.channelToFl(39))).toBe(scale.plotX(40));
    expect(scale.plotX(10) - scale.plotLeft).toBeCloseTo(scale.plotWidth / 4, 10);
    expect(scale.plotX(20) - scale.plotLeft).toBeCloseTo(scale.plotWidth / 2, 10);
    expect(scale.plotX(30) - scale.plotLeft).toBeCloseTo((3 * scale.plotWidth) / 4, 10);
  });

  it.each(["WBC", "RBC", "PLT"] as const)(
    "%s: discriminator channel X equals that curve bin X; ticks use the same plotX",
    (kind) => {
      const spec = XP_HISTOGRAM_SCALE[kind];
      const binCount = kind === "PLT" ? 40 : 50;
      const scale = histogramScaleForKind(kind, binCount, 28, 540);

      expect(scale.plotX(spec.xMin)).toBe(28);
      expect(scale.plotX(spec.xMax)).toBe(568);
      expect(scale.channelToFl(0)).toBe(spec.originFl);

      const sampleChannels = kind === "WBC" ? [6, 13, 19, 49] : kind === "RBC" ? [4, 49] : [1, 29];
      for (const channel of sampleChannels) {
        const fl = scale.channelToFl(channel);
        expect(scale.plotX(fl)).toBe(scale.plotX(scale.channelToFl(channel)));
      }

      for (const tick of spec.ticks) {
        const x = scale.plotX(tick);
        expect(x).toBeGreaterThanOrEqual(28);
        expect(x).toBeLessThanOrEqual(568);
      }

      if (kind === "WBC") {
        expect(spec.ticks).toEqual([100, 200, 300]);
        expect(spec.minorTicks).toEqual([50, 150, 250]);
        expect(scale.channelToFl(6)).toBe(42);
        expect(scale.channelToFl(49)).toBe(300);
        expect(isInteriorDiscriminator(scale.channelToFl(19), scale)).toBe(true);
        expect(isInteriorDiscriminator(scale.channelToFl(49), scale)).toBe(true);
      }
      if (kind === "RBC") {
        expect(spec.ticks).toEqual([100, 200]);
        expect(spec.minorTicks).toEqual([50, 150]);
        expect(scale.channelToFl(49)).toBe(250);
        expect(isInteriorDiscriminator(scale.channelToFl(4), scale)).toBe(true);
        expect(isInteriorDiscriminator(scale.channelToFl(49), scale)).toBe(true);
      }
      if (kind === "PLT") {
        expect(isInteriorDiscriminator(scale.channelToFl(1), scale)).toBe(true);
        expect(isInteriorDiscriminator(scale.channelToFl(29), scale)).toBe(true);
        expect(scale.channelToFl(29)).toBe(30);
      }
    },
  );

  it("writes a visual WBC/RBC/PLT test PDF using fL plotX mapping", () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const kinds: Array<{ kind: "WBC" | "RBC" | "PLT"; bins: number[]; discs: number[] }> = [
      {
        kind: "WBC",
        discs: [6, 13, 19, 49],
        bins: Array.from({ length: 50 }, (_, i) =>
          Math.round(80 * Math.exp(-((i - 10) ** 2) / 18) + 110 * Math.exp(-((i - 24) ** 2) / 40)),
        ),
      },
      {
        kind: "RBC",
        discs: [4, 49],
        bins: Array.from({ length: 50 }, (_, i) => Math.round(160 * Math.exp(-((i - 16) ** 2) / 22))),
      },
      {
        kind: "PLT",
        discs: [1, 29],
        bins: Array.from({ length: 40 }, (_, i) => Math.round(140 * Math.exp(-((i - 8) ** 2) / 20))),
      },
    ];

    pdf.setFontSize(14);
    pdf.text("CBC histogram X-mapping test", 20, 16);

    kinds.forEach((item, idx) => {
      const spec = XP_HISTOGRAM_SCALE[item.kind];
      const left = 20;
      const top = 28 + idx * 82;
      const plotLeft = left + 8;
      const plotWidth = 142;
      const plotTop = top + 8;
      const plotBottom = top + 42;
      const scale = histogramScaleForKind(item.kind, item.bins.length, plotLeft, plotWidth);
      const peak = Math.max(...item.bins, 1);

      pdf.setDrawColor(90);
      pdf.rect(plotLeft, plotTop, plotWidth, plotBottom - plotTop);
      pdf.setFontSize(11);
      pdf.text(item.kind, plotLeft, top + 5);

      const points = item.bins.map((h, i) => ({
        x: scale.plotX(scale.channelToFl(i)),
        y: plotBottom - (h / peak) * (plotBottom - plotTop),
      }));
      if (points.length) {
        const last = points[points.length - 1];
        if (last.x < plotLeft + plotWidth) {
          points.push({ x: plotLeft + plotWidth, y: last.y });
        }
      }
      pdf.setDrawColor(30, 96, 168);
      for (let i = 1; i < points.length; i++) {
        pdf.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
      }

      pdf.setDrawColor(120);
      for (const channel of item.discs) {
        const x = scale.plotX(scale.channelToFl(channel));
        pdf.line(x, plotTop, x, plotBottom);
      }

      pdf.setDrawColor(90);
      pdf.setFontSize(8);
      for (const tick of spec.minorTicks) {
        const x = scale.plotX(tick);
        pdf.line(x, plotBottom, x, plotBottom - 2);
      }
      for (const tick of spec.ticks) {
        const x = scale.plotX(tick);
        pdf.line(x, plotBottom, x, plotBottom - 2);
        pdf.text(String(tick), x, plotBottom + 4, { align: "center" });
      }
    });

    const outDir = dirname(fileURLToPath(import.meta.url));
    const pdfPath = join(outDir, "histogram-x-mapping-preview.pdf");
    writeFileSync(pdfPath, Buffer.from(pdf.output("arraybuffer")));
    expect(pdfPath.endsWith("histogram-x-mapping-preview.pdf")).toBe(true);
  });
});
