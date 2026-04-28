import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  wasRecentlyPropagated,
  wasRecentlyInvalidated,
  markInvalidated,
} from "@/lib/limsRealtimeDedupe";

type TableName =
  | "home_visits"
  | "estimates"
  | "estimate_tests"
  | "tests"
  | "phlebotomists"
  | "message_templates"
  | "abnormal_history"
  | "phlebotomist_leaves"
  | "outsourced_test_snips"
  | "patient_results"
  | "patient_registrations"
  | "sample_tubes"
  | "lims_test_orders"
  | "lims_interface_logs"
  | "lims_unmapped_results"
  | "lims_no_map_required";

/**
 * Cost-aware realtime subscription.
 *
 * - One channel per hook call, even when subscribing to multiple tables.
 * - Coalesces bursts into a single invalidation per key after `debounceMs`.
 * - Self-echo suppression: if the affected row was just touched locally via
 *   `propagateRegistrationChange`, the realtime echo is dropped — the actor
 *   has already refetched.
 * - Per-key dedupe (750 ms): the same key is never invalidated twice in
 *   quick succession by propagation + realtime.
 * - Hidden-tab gating: when `document.hidden`, only mark stale (no refetch).
 *   The visible tab will refetch on focus via React Query's default behaviour.
 * - Reconnect-only flush: the initial SUBSCRIBE no longer triggers a refetch
 *   (massive cost saving on tab switches). A reconnect still flushes once so
 *   no tab can be left on stale data after a WebSocket drop.
 */
export function useRealtimeSync(
  tables: TableName | TableName[],
  queryKeys: string[],
  debounceMs = 1500,
  options: { enabled?: boolean; filter?: string } = {},
) {
  const { enabled = true, filter } = options;
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  const tablesKey = Array.isArray(tables) ? tables.join(",") : tables;
  const channelKey = filter ? `${tablesKey}|${filter}` : tablesKey;

  useEffect(() => {
    if (!enabled) return;

    const tableList = Array.isArray(tables) ? tables : [tables];
    const hasSubscribedOnce = { current: false };

    const flush = (payloadId?: string) => {
      // Skip echoes for rows we just propagated locally — the actor's tab
      // already refetched via propagateRegistrationChange.
      if (payloadId && wasRecentlyPropagated(payloadId)) return;

      const hidden = typeof document !== "undefined" && document.hidden;

      keysRef.current.forEach((key) => {
        if (wasRecentlyInvalidated(key)) return;
        queryClient.invalidateQueries({
          queryKey: [key],
          // Hidden tabs: invalidate only (cheap). Visible tabs: refetch active.
          refetchType: hidden ? "none" : "active",
        });
        markInvalidated(key);
      });
    };

    const channel = supabase.channel(`realtime-${tablesKey}`);

    tableList.forEach((table) => {
      channel.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table } as never,
        (payload: { new?: { id?: string }; old?: { id?: string } }) => {
          const id = payload?.new?.id ?? payload?.old?.id;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            flush(id);
            timerRef.current = null;
          }, debounceMs);
        },
      );
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // First subscribe = initial mount; do NOT refetch (cache is fresh enough,
      // React Query's own staleness rules will handle it). Reconnect only.
      if (hasSubscribedOnce.current) flush();
      hasSubscribedOnce.current = true;
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, queryClient, debounceMs, enabled]);
}
