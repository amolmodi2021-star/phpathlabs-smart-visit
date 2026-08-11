import { LIMS_PAGE_SIZE_OPTIONS, type LimsPageSize, writeLimsPageSize } from "@/lib/limsListPrefs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PageSizeSelectProps {
  value: LimsPageSize;
  onChange: (size: LimsPageSize) => void;
  className?: string;
}

/** Page size control shared across LIMS queues (default 10). */
export default function PageSizeSelect({ value, onChange, className }: PageSizeSelectProps) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        const n = Number(v) as LimsPageSize;
        writeLimsPageSize(n);
        onChange(n);
      }}
    >
      <SelectTrigger className={className || "h-8 w-[88px] text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LIMS_PAGE_SIZE_OPTIONS.map((n) => (
          <SelectItem key={n} value={String(n)} className="text-xs">
            {n} / page
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
