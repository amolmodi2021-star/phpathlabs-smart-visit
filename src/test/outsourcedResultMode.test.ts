import { describe, expect, it } from "vitest";
import { isSnipResultDetail, isSnipResultRow, snipImageUrlsFromRow } from "@/lib/outsourcedResultMode";

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

  it("treats only result_mode=snip with images as a snip result", () => {
    expect(isSnipResultRow({ result_mode: "snip", snip_image_urls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultRow({ result_mode: "manual", snip_image_urls: ["https://a/1.png"] })).toBe(false);
    expect(isSnipResultRow({ result_mode: "snip", snip_image_urls: [] })).toBe(false);
    expect(isSnipResultRow(null)).toBe(false);
  });

  it("matches the Results/Verification detail-map shape", () => {
    expect(isSnipResultDetail({ resultMode: "snip", snipImageUrls: ["https://a/1.png"] })).toBe(true);
    expect(isSnipResultDetail({ resultMode: "manual", snipImageUrls: ["https://a/1.png"] })).toBe(false);
    expect(isSnipResultDetail({ resultMode: "snip", snipImageUrls: [] })).toBe(false);
  });
});
