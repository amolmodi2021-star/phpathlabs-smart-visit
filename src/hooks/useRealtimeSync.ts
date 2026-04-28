import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  | "message_send_log"
  | "lims_test_orders"
  | "lims_interface_logs"
  | "lims_unmapped_results"
  | "lims_no_map_required";

/**
 * Debounced realtime subscription with multi-user resilience.
 *
 * - Coalesces bursts of postgres_changes into a single invalidation per key
 *   after `debounceMs` of quiet (default 250 ms).
 * - Active queries are FORCE-REFETCHED so the visible tab updates immediately;
 *   inactive queries are only marked stale so multi-user fan-out stays cheap.
 * - On WebSocket reconnect (e.g. after a load spike or network blip), forces a
 *   one-shot invalidation so a stuck tab can never display stale data.
 *
 * `enabled` (default true): when false, skips channel subscription entirely.
 */
export function useRealtimeSync(
  table: TableName,
  queryKeys: string[],
  debounceMs = 250,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    if (!enabled) return;

    const flush = () => {
      keysRef.current.forEach((key) => {
        // Invalidate all observers, but force an immediate refetch only on the
        // currently mounted/active ones — keeps background tabs cheap.
        queryClient.invalidateQueries({ queryKey: [key], refetchType: "active" });
      });
    };

    const channel = supabase
      .channel(`realtime-${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            flush();
            timerRef.current = null;
          }, debounceMs);
        },
      )
      .subscribe((status) => {
        // On (re)subscribe, fire one immediate flush so a tab that was idle
        // during a disconnect cannot remain on stale data.
        if (status === "SUBSCRIBED") flush();
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryClient, debounceMs, enabled]);
}
