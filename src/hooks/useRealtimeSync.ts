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
 * Debounced realtime subscription. Coalesces bursts of postgres_changes
 * (e.g., bulk inserts during drip campaigns / machine result floods) into a
 * single invalidation per query key after `debounceMs` of quiet.
 *
 * Default 400ms — imperceptible to humans, drops 99% of redundant refetches
 * during bulk writes.
 *
 * `enabled` (default true): when false, skips channel subscription entirely.
 * Use this to suppress realtime fan-out during heavy writes (e.g. an active
 * marketing campaign) — set `enabled: !sending` and the broadcast wave that
 * would otherwise hit every subscriber's tab is eliminated.
 */
export function useRealtimeSync(
  table: TableName,
  queryKeys: string[],
  debounceMs = 400,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`realtime-${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            keysRef.current.forEach((key) => {
              queryClient.invalidateQueries({ queryKey: [key] });
            });
            timerRef.current = null;
          }, debounceMs);
        }
      )
      .subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryClient, debounceMs, enabled]);
}
