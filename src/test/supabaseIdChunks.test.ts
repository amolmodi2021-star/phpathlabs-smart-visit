import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, fetchInIdChunks, SUPABASE_ID_CHUNK } from "@/lib/supabaseIdChunks";

describe("fetchInIdChunks", () => {
  it("splits ids so a month-sized Daily Report lookup never sends one giant in()", async () => {
    const ids = Array.from({ length: 792 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    const rows = await fetchInIdChunks(ids, async (chunk) => {
      seen.push(chunk.length);
      expect(chunk.length).toBeLessThanOrEqual(SUPABASE_ID_CHUNK);
      return chunk.map((id) => ({ id }));
    });
    expect(seen.length).toBe(4);
    expect(seen[0]).toBe(200);
    expect(seen[3]).toBe(192);
    expect(rows).toHaveLength(792);
  });

  it("dedupes empty ids", async () => {
    const fetchChunk = vi.fn(async (chunk: string[]) => chunk.map((id) => ({ id })));
    const rows = await fetchInIdChunks(["a", "", "a", "b"], fetchChunk);
    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("fetchAllPages", () => {
  it("walks until a short page", async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, i) => i),
      Array.from({ length: 43 }, (_, i) => 1000 + i),
    ];
    const rows = await fetchAllPages(async (from, to) => {
      const page = from === 0 ? pages[0] : pages[1];
      expect(to - from + 1).toBe(1000);
      return page;
    });
    expect(rows).toHaveLength(1043);
  });
});

describe("Daily Report wiring", () => {
  it("chunks registration lookup and pages payment_transactions", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/lims/DailyReport.tsx"),
      "utf8",
    );
    expect(source).toContain("fetchInIdChunks");
    expect(source).toContain("fetchAllPages");
    expect(source).toContain("getRowDue");
    expect(source).not.toMatch(/\.in\("id", registrationIds\)/);
  });
});
