import { forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  show: boolean;
  className?: string;
}

/**
 * Tiny "NEW" badge shown on patient rows that have arrived in a module
 * since the user last visited/clicked them. Clears when the row is opened.
 */
const NewBadge = forwardRef<HTMLDivElement, Props>(({ show, className }, ref) => {
  if (!show) return null;
  return (
    <Badge
      ref={ref as any}
      variant="destructive"
      className={cn("text-[9px] leading-none px-1.5 py-0.5 h-4 font-bold animate-pulse", className)}
    >
      NEW
    </Badge>
  );
});
NewBadge.displayName = "NewBadge";

export default NewBadge;
