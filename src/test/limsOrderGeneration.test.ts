// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildOrderTestsForTube, sampleIdForTube } from "@/lib/limsOrderGeneration";

describe("limsOrderGeneration", () => {
  it("builds sample_id with suffix for fasting tubes", () => {
    expect(sampleIdForTube("2608110015", "-F")).toBe("2608110015-F");
    expect(sampleIdForTube("2608110015", "")).toBe("2608110015");
    expect(sampleIdForTube("2608110015", null)).toBe("2608110015");
  });

  it("includes only send_for_interface parameters", () => {
    const tests = buildOrderTestsForTube(
      ["t1"],
      { t1: { test_code: "CBC", test_name: "CBC", machine_id: "Sysmex" } },
      {
        t1: {
          hasAnyParam: true,
          params: [
            { code: "PRM1", name: "Hb", machine_id: "Sysmex", unit: "g/dL" },
          ],
        },
      }
    );
    expect(tests).toHaveLength(1);
    expect(tests[0].code).toBe("PRM1");
    expect(tests[0].machine_id).toBe("Sysmex");
    expect(tests[0].status).toBe("pending");
  });

  it("skips tests that have params but none flagged for interface", () => {
    const tests = buildOrderTestsForTube(
      ["t1"],
      { t1: { test_code: "NOTE", test_name: "Note", machine_id: "" } },
      { t1: { hasAnyParam: true, params: [] } }
    );
    expect(tests).toHaveLength(0);
  });

  it("falls back to test-level order when no parameters exist", () => {
    const tests = buildOrderTestsForTube(
      ["t1"],
      { t1: { test_code: "XRAY", test_name: "X-Ray", machine_id: "" } },
      {}
    );
    expect(tests).toEqual([
      { code: "XRAY", name: "X-Ray", unit: "", machine_id: "", status: "pending" },
    ]);
  });

  it("excludes cancelled test ids", () => {
    const tests = buildOrderTestsForTube(
      ["t1", "t2"],
      {
        t1: { test_code: "A", test_name: "A", machine_id: "" },
        t2: { test_code: "B", test_name: "B", machine_id: "" },
      },
      {},
      new Set(["t1"])
    );
    expect(tests.map((t) => t.code)).toEqual(["B"]);
  });
});
