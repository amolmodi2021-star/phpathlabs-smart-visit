/** PostgREST rejects a single `.in(id, …)` when the URL gets too long (~800+ UUIDs). */
export const SUPABASE_ID_CHUNK = 200;
export const SUPABASE_PAGE_SIZE = 1000;

export async function fetchInIdChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
  chunkSize = SUPABASE_ID_CHUNK,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const all: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    all.push(...(await fetchChunk(chunk)));
  }
  return all;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const rows = await fetchPage(from, from + pageSize - 1);
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
