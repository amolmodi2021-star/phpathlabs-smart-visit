import { describe, expect, it } from "vitest";
import { winAnsiSafe } from "@/lib/reportPdfSelectable";

describe("reportPdfSelectable", () => {
  it("keeps ASCII report text for the selectable layer", () => {
    expect(winAnsiSafe("CREATININE  1.2 mg/dL")).toBe("CREATININE 1.2 mg/dL");
  });

  it("strips unsupported glyphs without throwing", () => {
    expect(winAnsiSafe("Mr. Test 42")).toBe("Mr. Test 42");
  });
});