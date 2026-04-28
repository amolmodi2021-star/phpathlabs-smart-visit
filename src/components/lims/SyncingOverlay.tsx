import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ackArrived, getPending, subscribe, type SyncTarget } from "@/lib/limsSyncSignal";

interface Props {
  target: SyncTarget;
  /** IDs currently visible in the destination queue (used to auto-dismiss). */
  visibleIds?: string[];
  label?: string;
}

/**
 * Thin sticky banner that appears at the top of a destination tab when a
 * recent action pushed a registration into this module's queue but the
 * row has not yet appeared (server-side propagation + realtime debounce).
 *
 * Auto-dismisses when the expected regIds appear in `visibleIds` OR when
 * the TTL set by signalSync() expires.
 */
const SyncingOverlay = ({ target, visibleIds = [], label = "Syncing latest changes from previous step…" }: Props) => {
  const [pending, setPending] = useState(() => getPending(target));

  // Subscribe to signal changes
  useEffect(() => {
    const unsub = subscribe(() => setPending(getPending(target)));
    return unsub;
  }, [target]);

  // Tick to expire TTL even with no other signals
  useEffect(() => {
    if (!pending.active) return;
    const t = setInterval(() => setPending(getPending(target)), 500);
    return () => clearInterval(t);
  }, [pending.active, target]);

  // Acknowledge any expected IDs that have now appeared in the visible list
  useEffect(() => {
    if (!pending.active || visibleIds.length === 0) return;
    const visibleSet = new Set(visibleIds);
    const arrived = pending.regIds.filter((id) => visibleSet.has(id));
    if (arrived.length > 0) ackArrived(target, arrived);
  }, [pending, visibleIds, target]);

  if (!pending.active) return null;

  return (
    <div className="sticky top-0 z-30 mb-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary shadow-sm animate-fade-in">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
};

export default SyncingOverlay;
