import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Per-module "NEW" badge tracker.
 *
 * Stores the set of seen registration IDs for a given module in
 * sessionStorage (per-tab UI state — not data caching, not persisted
 * across browser sessions). On the very first visit we seed all current
 * IDs as seen so the user is not flooded with NEW badges on every row.
 *
 * Returns:
 *   isNew(id)    — true if id is in current list but not yet seen
 *   markSeen(id) — adds id to the seen set (call from row click/expand)
 */
export function useNewArrivalsBadge(moduleKey: string, currentIds: string[]) {
  const storageKey = `lims_seen_${moduleKey}`;
  const seededRef = useRef(false);

  const [seen, setSeen] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* noop */ }
    return new Set();
  });

  // Seed on first arrival (avoid flooding) + prune stale ids
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (currentIds.length === 0) return;

    const hadKey = sessionStorage.getItem(storageKey) !== null;

    setSeen((prev) => {
      const next = new Set(prev);
      let changed = false;

      if (!hadKey && !seededRef.current) {
        // First-ever visit this session: mark everything as seen
        currentIds.forEach((id) => {
          if (!next.has(id)) { next.add(id); changed = true; }
        });
        seededRef.current = true;
      } else {
        // Prune ids no longer in the list to keep storage small
        const currentSet = new Set(currentIds);
        for (const id of next) {
          if (!currentSet.has(id)) { next.delete(id); changed = true; }
        }
      }

      if (changed) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* noop */ }
      }
      return changed ? next : prev;
    });
  }, [currentIds, storageKey]);

  const isNew = useCallback((id: string) => {
    return !seen.has(id);
  }, [seen]);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);

  const newCount = useMemo(
    () => currentIds.reduce((n, id) => (seen.has(id) ? n : n + 1), 0),
    [currentIds, seen],
  );

  return { isNew, markSeen, newCount };
}
