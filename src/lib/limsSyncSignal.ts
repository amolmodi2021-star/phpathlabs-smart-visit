/**
 * Cross-tab "Syncing…" signal store for LIMS modules.
 *
 * When a user performs an action in one module that pushes a registration
 * into the next module's queue (Save & Verify, Send Back, Approve, etc.),
 * call signalSync(target, regId). When the user later switches to that
 * destination tab, an overlay banner shows "Syncing latest changes…"
 * until either (a) the regId appears in the destination list, or
 * (b) the TTL expires.
 *
 * Pure in-memory module state (no persistence) — survives only within the
 * SPA session, never across reloads.
 */

export type SyncTarget =
  | "results"
  | "verification"
  | "doctor_approval"
  | "dispatch"
  | "completed_hv"
  | "sample_collection"
  | "sample_acceptance";

type Pending = { regIds: Set<string>; expiresAt: number };

const pending: Record<string, Pending> = {};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => {
    try { l(); } catch { /* noop */ }
  });
}

function prune(target: SyncTarget) {
  const p = pending[target];
  if (!p) return;
  if (Date.now() > p.expiresAt || p.regIds.size === 0) {
    delete pending[target];
  }
}

export function signalSync(target: SyncTarget, regId: string | string[], ttlMs = 8000) {
  const ids = Array.isArray(regId) ? regId : [regId];
  if (ids.length === 0) return;
  const existing = pending[target];
  const expiresAt = Date.now() + ttlMs;
  if (existing) {
    ids.forEach((id) => existing.regIds.add(id));
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
  } else {
    pending[target] = { regIds: new Set(ids), expiresAt };
  }
  notify();
}

export function getPending(target: SyncTarget): { active: boolean; regIds: string[] } {
  prune(target);
  const p = pending[target];
  if (!p) return { active: false, regIds: [] };
  return { active: true, regIds: Array.from(p.regIds) };
}

/**
 * Mark a list of regIds as "seen" in the destination list — removes them
 * from the pending set. Called by the overlay once it observes the regIds
 * appear in the rendered queue.
 */
export function ackArrived(target: SyncTarget, regIds: string[]) {
  const p = pending[target];
  if (!p) return;
  let changed = false;
  regIds.forEach((id) => {
    if (p.regIds.delete(id)) changed = true;
  });
  if (p.regIds.size === 0) delete pending[target];
  if (changed) notify();
}

export function clearSync(target: SyncTarget) {
  if (pending[target]) {
    delete pending[target];
    notify();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
