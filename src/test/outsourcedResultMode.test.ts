import { describe, expect, it, vi } from "vitest";
import {
  appendOutsourcedSnipImage,
  clearTypedOutsourcedResults,
  hasOutsourcedSnipImages,
  isSnipResultDetail,
  isSnipResultRow,
  snipImageUrlsFromRow,
} from "@/lib/outsourcedResultMode";

describe("outsourcedResultMode", () => {
  it("reads urls from the jsonb array first", () => {
    expect(snipImageUrlsFromRow({
      snip_image_urls: ["https://a/1.png", "https://a/2.png"],
      snip_image_url: "https://legacy.png",
    })).toEqual(["https://a/1.png", "https://a/2.png"]);
  });

  it("falls back to the legacy single url", () => {
    expect(snipImageUrlsFromRow({ snip_image_url: "https://legacy.png" })).toEqual(["https://legacy.png"]);
  });

  it("treats any row with images as a snip result (manual+snip allowed)", () => {
    expect(isSnipResultRow({ result_mode: "snip", snip_image_urls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultRow({ result_mode: "manual", snip_image_urls: ["https://a/1.png"] })).toBe(true);
    expect(hasOutsourcedSnipImages({ result_mode: "manual", snip_image_urls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultRow({ result_mode: "snip", snip_image_urls: [] })).toBe(false);
    expect(isSnipResultRow(null)).toBe(false);
  });

  it("matches the Results/Verification detail-map shape by images", () => {
    expect(isSnipResultDetail({ resultMode: "snip", snipImageUrls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultDetail({ resultMode: "manual", snipImageUrls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultDetail({ resultMode: "snip", snipImageUrls: [] })).toBe(false);
  });

  it("clears only pending typed results for a test, optionally scoped to outsourced params", async () => {
    const paramIn = vi.fn().mockResolvedValue({ error: null });
    const statusIn = vi.fn(() => ({ in: paramIn }));
    const testEq = vi.fn(() => ({ in: statusIn }));
    const regEq = vi.fn(() => ({ eq: testEq }));
    const del = vi.fn(() => ({ eq: regEq }));
    const client = { from: vi.fn(() => ({ delete: del })) };

    await clearTypedOutsourcedResults(client, "reg-1", "test-1", ["p1", "p2"]);

    expect(client.from).toHaveBeenCalledWith("patient_results");
    expect(regEq).toHaveBeenCalledWith("registration_id", "reg-1");
    expect(testEq).toHaveBeenCalledWith("test_id", "test-1");
    expect(statusIn).toHaveBeenCalledWith("status", ["pending", "entered", "results_entered"]);
    expect(paramIn).toHaveBeenCalledWith("parameter_id", ["p1", "p2"]);
  });

  it("uploads a snip image and keeps typed patient_results", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "patient_results") throw new Error("must not clear typed results on snip upload");
      return { upsert };
    });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn/snip.png" } }));
    const client = {
      from,
      storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
    };

    const urls = await appendOutsourcedSnipImage(
      client,
      "reg-1",
      "test-1",
      { name: "page.png", type: "image/png" } as File,
      [],
    );

    expect(urls).toEqual(["https://cdn/snip.png"]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        registration_id: "reg-1",
        test_id: "test-1",
        result_mode: "snip",
        snip_image_urls: ["https://cdn/snip.png"],
      }),
      { onConflict: "registration_id,test_id" },
    );
    expect(from).not.toHaveBeenCalledWith("patient_results");
  });
});
