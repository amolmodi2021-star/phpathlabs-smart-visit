import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RefreshButtonProps {
  /** First element of each query key to invalidate (e.g. "sample_tubes_collection"). */
  queryKeys: string[];
  label?: string;
  className?: string;
}

/**
 * Explicit refresh for LIMS workflow stages.
 * Invalidates and refetches the listed React Query caches so users
 * pull the latest queue/list data without a full page reload.
 */
const RefreshButton = ({ queryKeys, label = "Refresh", className }: RefreshButtonProps) => {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(
        queryKeys.map((k) =>
          qc.invalidateQueries({ queryKey: [k], refetchType: "active" })
        )
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
