import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Manually triggers the report queue processor.
 * Loops until no more pending reports remain (capped at 20 iterations as a safety net).
 * Shows progress toasts so the user can see what's happening.
 *
 * Returns total number of reports processed in this session.
 */
export async function triggerReportQueue(opts?: { silent?: boolean }): Promise<number> {
  const silent = opts?.silent === true;
  let processedCount = 0;
  const MAX_ITER = 20;

  if (!silent) {
    toast({ title: "Processing report queue…" });
  }

  try {
    for (let i = 0; i < MAX_ITER; i++) {
      const { data, error } = await supabase.functions.invoke("process-report-queue");
      if (error) {
        if (!silent) toast({ title: "Queue processor error", description: error.message, variant: "destructive" });
        break;
      }

      if (!data?.processed) {
        // No more pending reports
        break;
      }

      processedCount += 1;
      const remaining = Number(data?.remainingPending || 0);

      if (!silent) {
        toast({
          title: `Processed ${processedCount} report${processedCount === 1 ? "" : "s"}`,
          description: remaining > 0 ? `${remaining} still pending…` : "Queue is empty.",
        });
      }

      if (remaining === 0) break;

      // Small delay between iterations so the DB & UI keep up.
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!silent) {
      if (processedCount === 0) {
        toast({ title: "Queue is already empty", description: "No pending reports to process." });
      } else {
        toast({ title: `Done — ${processedCount} report${processedCount === 1 ? "" : "s"} processed.` });
      }
    }
  } catch (e: any) {
    if (!silent) toast({ title: "Failed to trigger queue", description: e?.message || String(e), variant: "destructive" });
  }

  return processedCount;
}
