/**
 * Tiny in-memory TTL maps used to suppress redundant React-Query invalidations
 * triggered by the realtime subscription right after a propagation has already
 * refetched the same data. Pure client-side, zero network/storage cost.
 *
 * - `markPropagated(regId)`: called by `propagateRegistrationChange` so that
 *   realtime echoes for the actor's own write are skipped (5 s window).
 * - `markInvalidated(queryKey)`: short window (750 ms) preventing the same key
 *   from being invalidated twice in rapid succession (propagate + realtime).
 */

const propagatedIds = new Map<string, number>();
const invalidatedKeys = new Map<string, number>();

const PROPAGATED_TTL_MS = 5000;
const INVALIDATED_TTL_MS = 750;

function gc(map: Map<string, number>) {
  const now = Date.now();
  for (const [k, exp] of map) {
    if (exp <= now) map.delete(k);
  }
}

export function markPropagated(regId: string): void {
  propagatedIds.set(regId, Date.now() + PROPAGATED_TTL_MS);
  if (propagatedIds.size > 200) gc(propagatedIds);
}

export function wasRecentlyPropagated(regId: string): boolean {
  const exp = propagatedIds.get(regId);
  if (!exp) return false;
  if (exp <= Date.now()) {
    propagatedIds.delete(regId);
    return false;
  }
  return true;
}

export function markInvalidated(key: string): void {
  invalidatedKeys.set(key, Date.now() + INVALIDATED_TTL_MS);
  if (invalidatedKeys.size > 200) gc(invalidatedKeys);
}

export function wasRecentlyInvalidated(key: string): boolean {
  const exp = invalidatedKeys.get(key);
  if (!exp) return false;
  if (exp <= Date.now()) {
    invalidatedKeys.delete(key);
    return false;
  }
  return true;
}
