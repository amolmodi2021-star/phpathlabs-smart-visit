// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hasRenderableHistograms,
  mergeHistogramSnapshots,
  normalizeHistogramRows,
} from "@/lib/analyzerHistograms";
import { normalizeImageDataUrl } from "@/lib/reportAssetCache";

describe("analyzerHistograms", () => {
  it("ignores empty or short bin arrays", () => {
    expect(normalizeHistogramRows([{ kind: "WBC", bins: [1, 2] }])).toEqual([]);
    expect(hasRenderableHistograms([])).toBe(false);
  });

  it("requires all three CBC kinds before PDF histograms are renderable", () => {
    const pltOnly = normalizeHistogramRows([{ kind: "PLT", bins: Array(40).fill(1) }]);
    expect(hasRenderableHistograms(pltOnly)).toBe(false);

    const wbcRbc = normalizeHistogramRows([
      { kind: "WBC", bins: Array(50).fill(1) },
      { kind: "RBC", bins: Array(50).fill(2) },
    ]);
    expect(hasRenderableHistograms(wbcRbc)).toBe(false);

    const full = normalizeHistogramRows([
      { kind: "WBC", bins: Array(50).fill(1) },
      { kind: "RBC", bins: Array(50).fill(2) },
      { kind: "PLT", bins: Array(40).fill(3) },
    ]);
    expect(hasRenderableHistograms(full)).toBe(true);
  });

  it("merges live kinds without overwriting an existing snapshot", () => {
    const existing = normalizeHistogramRows([
      { kind: "WBC", bins: Array(50).fill(1) },
    ]);
    const live = normalizeHistogramRows([
      { kind: "WBC", bins: Array(50).fill(9) },
      { kind: "RBC", bins: Array(50).fill(3) },
      { kind: "PLT", bins: Array(40).fill(4) },
    ]);
    const merged = mergeHistogramSnapshots(existing, live);
    expect(merged.map((h) => h.kind)).toEqual(["WBC", "RBC", "PLT"]);
    expect(merged[0].bins[0]).toBe(1);
    expect(hasRenderableHistograms(merged)).toBe(true);
  });
});

describe("normalizeImageDataUrl", () => {
  it("rewrites JPEG octet-stream data URLs to image/jpeg", () => {
    const jpegHead = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]).toString("base64");
    const bad = "data:application/octet-stream;base64," + jpegHead;
    expect(normalizeImageDataUrl(bad)?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("leaves proper image data URLs unchanged", () => {
    const ok = "data:image/jpeg;base64,/9j/4AAQ";
    expect(normalizeImageDataUrl(ok)).toBe(ok);
  });
});
