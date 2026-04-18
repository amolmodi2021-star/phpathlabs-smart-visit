import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginatedTableFooterProps {
  page: number; // 0-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const PaginatedTableFooter = ({
  page,
  pageSize,
  total,
  onPageChange,
  className = "",
}: PaginatedTableFooterProps) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  if (total <= pageSize) {
    return (
      <div className={`flex items-center justify-end text-xs text-muted-foreground py-2 ${className}`}>
        {total > 0 ? `Showing ${from}–${to} of ${total.toLocaleString()}` : "No records"}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-2 py-2 ${className}`}>
      <span className="text-xs text-muted-foreground">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Page {page + 1} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
};

export default PaginatedTableFooter;
