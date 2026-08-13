import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LimsModule } from "@/lib/limsPropagation";
import { shortIdsKey } from "@/lib/queryKeys";

/**
 * Live sync for LIMS workflow modules.
 *
 * Full pipeline-table realtime remains disabled for egress control. Results
 * Entry consumes only the tiny lims_result_notify INSERT stream produced after
 * successful analyzer writes. Other modules remain Refresh-button driven.
 */
interface ResultsRealtimeState {
  expandedRegistrationId?: string | null;
  candidateRegistrationIds?: readonly string[];
}

const DEFAULT_RESULTS_DEBOUNCE_MS = 750;

export function useLimsPipelineRealtime(
  module: LimsModule,
  debounceMs = DEFAULT_RESULTS_DEBOUNCE_MS,
  resultsState: ResultsRealtimeState = {},
) {
  const queryClient = useQueryClient();
  const expandedRegistrationRef = useRef<string | null>(
    resultsState.expandedRegistrationId ?? null,
  );
  const candidateRegistrationIdsRef = useRef<Set<string>>(
    new Set(resultsState.candidateRegistrationIds ?? []),
  );

  expandedRegistrationRef.current = resultsState.expandedRegistrationId ?? null;
  candidateRegistrationIdsRef.current = new Set(
    resultsState.candidateRegistrationIds ?? [],
  );

  useEffect(() => {
    if (module !== "results") return;

    const affectedRegistrationIds = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let subscribedOnce = false;
    let disconnectedAfterSubscribe = false;
    let catchUpNeeded = false;
    let wasHidden = typeof document !== "undefined" && document.hidden;
    let disposed = false;

    const invalidateExpandedPatient = (registrationId: string) =>
      queryClient.invalidateQueries({
        queryKey: [
          "patient_results_existing",
          shortIdsKey([registrationId], "re-d"),
        ],
        exact: true,
        refetchType: "active",
      });

    const invalidateCandidateQueue = () =>
      queryClient.invalidateQueries({
        queryKey: ["results_accepted_count"],
        refetchType: "active",
      });

    const flush = () => {
      flushTimer = null;
      if (disposed) return;

      if (typeof document !== "undefined" && document.hidden) {
        catchUpNeeded = true;
        return;
      }

      const expandedRegistrationId = expandedRegistrationRef.current;
      const shouldRefreshExpanded =
        !!expandedRegistrationId &&
        (catchUpNeeded ||
          affectedRegistrationIds.has(expandedRegistrationId));
      const shouldRefreshQueue =
        catchUpNeeded ||
        Array.from(affectedRegistrationIds).some((registrationId) =>
          candidateRegistrationIdsRef.current.has(registrationId),
        );

      affectedRegistrationIds.clear();
      catchUpNeeded = false;

      const invalidations: Promise<unknown>[] = [];
      if (shouldRefreshExpanded && expandedRegistrationId) {
        invalidations.push(invalidateExpandedPatient(expandedRegistrationId));
      }
      if (shouldRefreshQueue) {
        invalidations.push(invalidateCandidateQueue());
      }
      void Promise.all(invalidations);
    };

    const scheduleFlush = () => {
      if (disposed || flushTimer) return;
      if (typeof document !== "undefined" && document.hidden) {
        catchUpNeeded = true;
        return;
      }
      // Fixed batching window: bursts coalesce without indefinitely delaying UI.
      flushTimer = setTimeout(flush, debounceMs);
    };

    const scheduleCatchUp = () => {
      catchUpNeeded = true;
      scheduleFlush();
    };

    const channel = supabase
      .channel("lims-results-notify")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lims_result_notify",
        },
        (payload: { new?: { registration_id?: string | null } }) => {
          if (disposed) return;
          const registrationId = payload.new?.registration_id;
          if (!registrationId) return;
          affectedRegistrationIds.add(registrationId);
          scheduleFlush();
        },
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          if (subscribedOnce && disconnectedAfterSubscribe) {
            scheduleCatchUp();
          }
          subscribedOnce = true;
          disconnectedAfterSubscribe = false;
          return;
        }
        if (
          subscribedOnce &&
          (status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED")
        ) {
          disconnectedAfterSubscribe = true;
        }
      });

    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        scheduleCatchUp();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      disposed = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      void supabase.removeChannel(channel);
    };
  }, [module, debounceMs, queryClient]);
}
