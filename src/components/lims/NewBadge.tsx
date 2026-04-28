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
const NewBadge = ({ show, className }: Props) => {
  if (!show) return null;
  return (
    <Badge
      variant="destructive"
      className={cn("text-[9px] leading-none px-1.5 py-0.5 h-4 font-bold animate-pulse", className)}
    >
      NEW
    </Badge>
  );
};

export default NewBadge;
