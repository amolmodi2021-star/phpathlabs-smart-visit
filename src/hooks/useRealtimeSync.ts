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
  | "approved_reports"
  | "whatsapp_console_outbox"
  | "lims_test_orders"
  | "lims_interface_logs"
  | "lims_unmapped_results"
  | "lims_no_map_required"
  | "lims_result_notify";

/**
 * Cost-aware realtime subscription.
 *
 * - One channel per hook call, even when subscribing to multiple tables.
 * - Coalesces bursts into a single invalidation per key after `debounceMs`.
 * - Self-echo suppression: if the affected row / registration was just touched
 *   locally via `propagateRegistrationChange`, the realtime echo is dropped.
 * - Per-key dedupe (2 s): the same key is never invalidated twice in
 *   quick succession by propagation + realtime.
 * - Hidden-tab gating: when `document.hidden`, only mark stale (no refetch).
 * - Reconnect-only flush: the initial SUBSCRIBE no longer triggers a refetch.
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
    /** Trailing debounce: only skip flush if EVERY event in the window was a self-echo */
    const burstHadExternalChange = { current: false };

    const flush = () => {
      if (!burstHadExternalChange.current) return;
      burstHadExternalChange.current = false;

      const hidden = typeof document !== "undefined" && document.hidden;

      keysRef.current.forEach((key) => {
        if (wasRecentlyInvalidated(key)) return;
        queryClient.invalidateQueries({
          queryKey: [key],
          refetchType: hidden ? "none" : "active",
        });
        markInvalidated(key);
      });
    };

    const channel = supabase.channel(`realtime-${channelKey}`);

    tableList.forEach((table) => {
      const config: Record<string, unknown> = { event: "*", schema: "public", table };
      if (filter) config.filter = filter;
      channel.on(
        "postgres_changes" as never,
        config as never,
        (payload: {
          new?: { id?: string; registration_id?: string };
          old?: { id?: string; registration_id?: string };
        }) => {
          const id = payload?.new?.id ?? payload?.old?.id;
          const registrationId =
            payload?.new?.registration_id ?? payload?.old?.registration_id;
          const isEcho =
            (!!id && wasRecentlyPropagated(id)) ||
            (!!registrationId && wasRecentlyPropagated(registrationId));
          if (!isEcho) burstHadExternalChange.current = true;

          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            flush();
            timerRef.current = null;
          }, debounceMs);
        },
      );
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Reconnect only: force a refresh so missed events while offline are picked up
      if (hasSubscribedOnce.current) {
        burstHadExternalChange.current = true;
        flush();
      }
      hasSubscribedOnce.current = true;
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, queryClient, debounceMs, enabled, filter]);
}
