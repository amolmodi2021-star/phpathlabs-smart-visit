import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { fetchPatientTestPipeline } from "@/lib/fetchPatientTestPipeline";
import {
  PIPELINE_STATUS_LABEL,
  summarizePipeline,
  type PipelineTestStatus,
} from "@/lib/testPipelineStatus";

function statusBadge(status: PipelineTestStatus) {
  switch (status) {
    case "registered":
      return <Badge variant="outline" className="text-[10px]">Registered</Badge>;
    case "collect_later":
      return <Badge variant="outline" className="text-[10px] border-sky-500 text-sky-700">Collect later</Badge>;
    case "repeat_collection":
      return <Badge variant="outline" className="text-[10px] border-rose-500 text-rose-700">Repeat</Badge>;
    case "sample_collected":
      return <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600">Collected</Badge>;
    case "sample_accepted":
      return <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-700">Accepted</Badge>;
    case "outsourced":
      return <Badge variant="outline" className="text-[10px] border-purple-500 text-purple-700">Outsourced</Badge>;
    case "results_entered":
      return <Badge className="text-[10px] bg-indigo-500">Entered</Badge>;
    case "verified":
      return <Badge className="text-[10px] bg-purple-600">Verified</Badge>;
    case "approved":
      return <Badge className="text-[10px] bg-green-600">Approved</Badge>;
    case "dispatched":
      return <Badge className="text-[10px] bg-blue-600">Dispatched</Badge>;
    case "cancelled":
      return <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>;
  }
}

type Props = {
  registrationId: string;
  /** Optional invoice for aria label */
  invoiceNumber?: string | null;
};

/**
 * Hover-only pipeline overview for one bill.
 * Does not alter tab queues; fetches lean status data only when opened.
 */
const PatientTestPipelineHover = ({ registrationId, invoiceNumber }: Props) => {
  const [open, setOpen] = useState(false);

  const { data: rows = [], isFetching, isError, error } = useQuery({
    queryKey: ["patient_test_pipeline", registrationId],
    queryFn: () => fetchPatientTestPipeline(registrationId),
    enabled: open && !!registrationId,
    staleTime: 45_000,
  });

  const counts = summarizePipeline(rows);
  const summaryBits = (
    Object.entries(counts) as [PipelineTestStatus, number][]
  )
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${PIPELINE_STATUS_LABEL[k]}`);

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={180} closeDelay={120}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Pipeline status for ${invoiceNumber || "patient"}`}
          title="All tests — latest status"
        >
          <ListChecks className="h-3.5 w-3.5" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-[340px] p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold">Tests on this bill</div>
            <div className="text-[10px] text-muted-foreground">Latest status only</div>
          </div>
          {summaryBits.length > 0 && (
            <div className="text-[10px] text-muted-foreground leading-snug">
              {summaryBits.join(" · ")}
            </div>
          )}
          {isFetching && rows.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : isError ? (
            <div className="text-xs text-destructive py-2">
              {(error as Error)?.message || "Failed to load statuses"}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No tests found</div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto space-y-1 pr-1">
              {rows.map((r) => (
                <div
                  key={r.testId}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                >
                  <span className="text-xs truncate min-w-0" title={r.testName}>
                    {r.testName}
                  </span>
                  <span className="shrink-0">{statusBadge(r.status)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default PatientTestPipelineHover;