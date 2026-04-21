import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export interface TimelineStep {
  label: string;
  shortLabel: string;
  timestamp: string | null;
}

interface Props {
  steps: TimelineStep[];
  compact?: boolean;
}

const TestStatusTimeline = ({ steps, compact = false }: Props) => {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-1">
        {steps.map((step, idx) => {
          const isDone = !!step.timestamp;
          const isLast = idx === steps.length - 1;
          const nextDone = !isLast && !!steps[idx + 1].timestamp;
          return (
            <div key={idx} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center min-w-0">
                <div
                  className={cn(
                    "rounded-full flex items-center justify-center transition-colors shrink-0",
                    compact ? "h-5 w-5" : "h-7 w-7",
                    isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-muted border-2 border-border text-muted-foreground"
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className={compact ? "h-3 w-3" : "h-4 w-4"} />
                  ) : (
                    <Circle className={compact ? "h-2 w-2" : "h-3 w-3"} />
                  )}
                </div>
                <span
                  className={cn(
                    "mt-1 text-[10px] font-medium text-center leading-tight",
                    isDone ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {compact ? step.shortLabel : step.label}
                </span>
                {step.timestamp && !compact && (
                  <span className="text-[9px] text-muted-foreground mt-0.5">
                    {format(new Date(step.timestamp), "dd MMM, hh:mm a")}
                  </span>
                )}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1 transition-colors",
                    nextDone ? "bg-emerald-500" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TestStatusTimeline;
