/** Stable short cache key from a list of IDs (avoids megakey collision / memory). */
export function shortIdsKey(ids: string[], prefix = ""): string {
  if (!ids.length) return `${prefix}:0`;
  const sorted = [...ids].sort();
  let h = 2166136261;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 124;
    h = Math.imul(h, 16777619);
  }
  return `${prefix}:${ids.length}:${(h >>> 0).toString(36)}`;
}
