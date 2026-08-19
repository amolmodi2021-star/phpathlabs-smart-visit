import { describe, expect, it } from "vitest";
import { resolveOutsourcedFlag } from "@/lib/outsourcedResultOverrides";

describe("resolveOutsourcedFlag", () => {
  it("auto-flags on first entry when saved flag is empty", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: true,
        editedFlag: undefined,
        savedFlag: "",
        autoFlag: "H",
        currentValue: "200",
        savedValue: "",
      }),
    ).toBe("H");
  });

  it("auto-flags when saved flag is null", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: true,
        editedFlag: undefined,
        savedFlag: null,
        autoFlag: "L",
        currentValue: "1",
        savedValue: "1",
      }),
    ).toBe("L");
  });

  it("keeps manual Normal when value unchanged and auto would be H", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: true,
        editedFlag: undefined,
        savedFlag: "N",
        autoFlag: "H",
        currentValue: "200",
        savedValue: "200",
      }),
    ).toBe("N");
  });

  it("session edit wins over saved and auto", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: true,
        editedFlag: "N",
        savedFlag: "H",
        autoFlag: "H",
        currentValue: "200",
        savedValue: "200",
      }),
    ).toBe("N");
  });

  it("recomputes auto when value changes", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: true,
        editedFlag: undefined,
        savedFlag: "N",
        autoFlag: "H",
        currentValue: "250",
        savedValue: "200",
      }),
    ).toBe("H");
  });

  it("non-outsourced always uses auto", () => {
    expect(
      resolveOutsourcedFlag({
        isOutsourced: false,
        editedFlag: "N",
        savedFlag: "N",
        autoFlag: "H",
        currentValue: "200",
        savedValue: "200",
      }),
    ).toBe("H");
  });
});
