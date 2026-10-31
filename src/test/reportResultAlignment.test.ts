// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldWidenResult } from "@/components/report/ReportResultsSection";

describe("shouldWidenResult", () => {
  it("uses the reference column whenever that range is empty", () => {
    expect(shouldWidenResult("Self manipulation", false)).toBe(true);
    expect(shouldWidenResult("04:40 PM", false)).toBe(true);
    expect(shouldWidenResult("75 %", false)).toBe(true);
    expect(shouldWidenResult("3", false)).toBe(true);
    expect(shouldWidenResult("40 %", true)).toBe(false);
    expect(shouldWidenResult("Greyish white", true)).toBe(false);
  });
});