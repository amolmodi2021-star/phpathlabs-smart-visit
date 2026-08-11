import type { LimsModule } from "@/lib/limsPropagation";

/**
 * Live sync for LIMS workflow modules.
 * DISABLED for egress control: queues are Refresh-button driven and cached.
 * Patient details load only when a card is opened — realtime was refetching
 * full results/tubes/snips for every open tab on each analyzer write.
 */
export function useLimsPipelineRealtime(_module: LimsModule, _debounceMs?: number) {
  // no-op
}
