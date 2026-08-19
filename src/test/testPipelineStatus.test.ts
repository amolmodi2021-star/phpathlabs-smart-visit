import { describe, expect, it } from "vitest";
import {
  buildPipelineOverview,
  deriveTestPipelineStatus,
  pickFurthestStatus,
  snipProgressStatus,
} from "@/lib/testPipelineStatus";

describe("testPipelineStatus", () => {
  it("pickFurthestStatus prefers dispatched over earlier stages", () => {
    expect(pickFurthestStatus("registered", "sample_accepted", "dispatched")).toBe("dispatched");
  });

  it("sent/pending snip is Outsourced, not Entered", () => {
    expect(snipProgressStatus({ outsource_status: "sent" })).toBe("outsourced");
    expect(snipProgressStatus({ outsource_status: "pending" })).toBe("outsourced");
    expect(
      snipProgressStatus({
        outsource_status: "results_entered",
        result_mode: "snip",
        snip_image_urls: [],
      }),
    ).toBe("outsourced");
    expect(
      snipProgressStatus({
        outsource_status: "results_entered",
        result_mode: "snip",
        snip_image_urls: ["https://x/a.png"],
      }),
    ).toBe("results_entered");
  });

  it("derive marks outsourced master without results as Outsourced", () => {
    expect(
      deriveTestPipelineStatus({
        isOutsourcedMaster: true,
        tube: { status: "accepted" },
        resultStatuses: [],
        snip: null,
      }),
    ).toBe("outsourced");

    expect(
      deriveTestPipelineStatus({
        isOutsourcedMaster: true,
        tube: { status: "accepted" },
        resultStatuses: [],
        snip: { outsource_status: "sent" },
      }),
    ).toBe("outsourced");
  });

  it("derive advances Entered → Verified → Approved when results exist", () => {
    expect(
      deriveTestPipelineStatus({
        isOutsourcedMaster: true,
        resultStatuses: ["entered"],
        snip: { outsource_status: "sent" },
      }),
    ).toBe("results_entered");

    expect(
      deriveTestPipelineStatus({
        isOutsourcedMaster: true,
        resultStatuses: ["verified"],
      }),
    ).toBe("verified");

    expect(
      deriveTestPipelineStatus({
        isOutsourcedMaster: true,
        snip: {
          outsource_status: "approved",
          result_mode: "snip",
          snip_image_urls: ["https://x/a.png"],
        },
      }),
    ).toBe("approved");
  });

  it("buildPipelineOverview maps tube/result/snip to latest status without timestamps", () => {
    const rows = buildPipelineOverview({
      registration: {
        tests: [
          { test_id: "t1", test_name: "CBC" },
          { test_id: "t2", test_name: "LFT" },
          { test_id: "t3", test_name: "TSH" },
          { test_id: "t4", test_name: "DOUBLE MARKER" },
        ],
        cancelled_tests: [],
        repeat_tests: [{ test_id: "t3" }],
        bill_cancelled: false,
      },
      tubes: [
        { test_ids: ["t1"], status: "accepted" },
        { test_ids: ["t2"], status: "deferred" },
        { test_ids: ["t3"], status: "pending" },
        { test_ids: ["t4"], status: "accepted" },
      ],
      resultRows: [{ test_id: "t1", status: "verified" }],
      snips: [{ test_id: "t4", outsource_status: "sent" }],
      testsMap: {
        t4: { test_name: "DOUBLE MARKER", is_outsourced: true },
      },
      leafTests: [
        { test_id: "t1", test_name: "CBC" },
        { test_id: "t2", test_name: "LFT" },
        { test_id: "t3", test_name: "TSH" },
        { test_id: "t4", test_name: "DOUBLE MARKER" },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.testId, r.status]));
    expect(byId.t1).toBe("verified");
    expect(byId.t2).toBe("collect_later");
    expect(byId.t3).toBe("repeat_collection");
    expect(byId.t4).toBe("outsourced");
  });

  it("outsourced with no parameters stays Outsourced until results exist", () => {
    const rows = buildPipelineOverview({
      registration: {
        tests: [{ test_id: "t1", test_name: "HB ELECTROPHORESIS" }],
        cancelled_tests: [],
        repeat_tests: [],
        bill_cancelled: false,
      },
      tubes: [{ test_ids: ["t1"], status: "accepted" }],
      resultRows: [],
      snips: [],
      testsMap: { t1: { test_name: "HB ELECTROPHORESIS", is_outsourced: true } },
      leafTests: [{ test_id: "t1", test_name: "HB ELECTROPHORESIS" }],
      hasParamsByTestId: { t1: false },
    });
    expect(rows[0]?.status).toBe("outsourced");
  });
});
