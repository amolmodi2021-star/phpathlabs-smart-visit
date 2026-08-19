// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hasRenderableHistograms,
  mergeHistogramSnapshots,
  normalizeHistogramRows,
} from "@/lib/analyzerHistograms";

describe("analyzerHistograms", () => {
  it("ignores empty or short bin arrays", () => {
    expect(normalizeHistogramRows([{ kind: "WBC", bins: [1, 2] }])).toEqual([]);
    expect(hasRenderableHistograms([])).toBe(false);
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
