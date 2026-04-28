import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  show: boolean;
  className?: string;
}

/**
 * Tiny "NEW" badge shown on patient rows that have arrived in a module
 * since the user last visited/clicked them. Clears when the row is opened.
 *
 * Rendered as a span (not the shadcn Badge) so parents/Radix can attach refs
 * without React warnings.
 */
const NewBadge = forwardRef<HTMLSpanElement, Props>(({ show, className }, ref) => {
  if (!show) return null;
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-destructive text-destructive-foreground text-[9px] leading-none px-1.5 py-0.5 h-4 font-bold animate-pulse",
        className,
      )}
    >
      NEW
    </span>
  );
});
NewBadge.displayName = "NewBadge";

export default NewBadge;
