import { describe, expect, it } from "vitest";
import { referenceRangeLines } from "@/components/report/FitReferenceRange";

describe("referenceRangeLines", () => {
  it("keeps each Test Management line intact", () => {
    const text = "No Risk: > 60 mg/dL\nModerate Risk: 40 - 60 mg/dL\nHigh Risk: < 40 mg/dL";
    expect(referenceRangeLines(text)).toEqual([
      "No Risk: > 60 mg/dL",
      "Moderate Risk: 40 - 60 mg/dL",
      "High Risk: < 40 mg/dL",
    ]);
  });

  it("preserves a blank line from the master text", () => {
    expect(referenceRangeLines("A\n\nB")).toEqual(["A", "", "B"]);
  });
});