import { describe, expect, it } from "vitest";
import { buildPipelineOverview, pickFurthestStatus } from "@/lib/testPipelineStatus";

describe("testPipelineStatus", () => {
  it("pickFurthestStatus prefers dispatched over earlier stages", () => {
    expect(pickFurthestStatus("registered", "sample_accepted", "dispatched")).toBe("dispatched");
  });

  it("buildPipelineOverview maps tube/result/snip to latest status without timestamps", () => {
    const rows = buildPipelineOverview({
      registration: {
        tests: [
          { test_id: "t1", test_name: "CBC" },
          { test_id: "t2", test_name: "LFT" },
          { test_id: "t3", test_name: "TSH" },
        ],
        cancelled_tests: [],
        repeat_tests: [{ test_id: "t3" }],
        bill_cancelled: false,
      },
      tubes: [
        { test_ids: ["t1"], status: "accepted" },
        { test_ids: ["t2"], status: "deferred" },
        { test_ids: ["t3"], status: "pending" },
      ],
      resultRows: [{ test_id: "t1", status: "verified" }],
      snips: [],
      testsMap: {},
      leafTests: [
        { test_id: "t1", test_name: "CBC" },
        { test_id: "t2", test_name: "LFT" },
        { test_id: "t3", test_name: "TSH" },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.testId, r.status]));
    expect(byId.t1).toBe("verified");
    expect(byId.t2).toBe("collect_later");
    expect(byId.t3).toBe("repeat_collection");
  });
});
