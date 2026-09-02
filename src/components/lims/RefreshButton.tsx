import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type QueryKeyInput = string | readonly string[];

interface RefreshButtonProps {
  /**
   * Query key prefix(es) to refresh.
   * - string → matches ["thatString", ...]
   * - string[] → exact/prefix array key (e.g. ["completed_home_visits"])
   */
  queryKeys: QueryKeyInput[];
  label?: string;
  className?: string;
}

function toQueryKey(k: QueryKeyInput): readonly string[] {
  return Array.isArray(k) ? k : [k];
}

/**
 * Explicit refresh for LIMS workflow stages.
 *
 * Egress-safe:
 * 1) Mark matching caches stale (including inactive/detail queries) without fetching them.
 * 2) Force-refetch only active observers (the visible tab's live queries).
 *
 * This avoids the common failure where list IDs refresh but expanded-patient
 * detail stayed on an old cache until a full Ctrl+Shift+R.
 */
const RefreshButton = ({ queryKeys, label = "Refresh", className }: RefreshButtonProps) => {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const keys = queryKeys.map(toQueryKey);

      // Cancel any hung in-flight request for these keys, then mark stale.
      await Promise.all(
        keys.map((queryKey) => qc.cancelQueries({ queryKey })),
      );
      await Promise.all(
        keys.map((queryKey) =>
          qc.invalidateQueries({ queryKey, refetchType: "none" }),
        ),
      );
      // Network only for what is currently on screen (active + enabled).
      await Promise.all(
        keys.map((queryKey) =>
          qc.refetchQueries({ queryKey, type: "active" }),
        ),
      );

      toast.success("List refreshed");
    } catch (e: any) {
      toast.error(e?.message || "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={busy}
      title="Reload latest queue data from server"
      className={cn("gap-1.5", className)}
    >
      <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
      {label}
    </Button>
  );
};

export default RefreshButton;
