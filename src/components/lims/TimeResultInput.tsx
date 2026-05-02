import { Input } from "@/components/ui/input";
import { TIME_RESULT_PATTERN, buildCanonicalTime, toCanonicalTimeResult } from "@/lib/timeRange";

interface Props {
  value: string;
  onChange: (canonical: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  disabled?: boolean;
  abnormal?: boolean;
}

/**
 * Renders two compact boxes "[Min] : [Sec]" and emits a canonical "M:SS" string.
 * Empty min and empty sec → emits "" (no result).
 */
export default function TimeResultInput({ value, onChange, onKeyDown, className, disabled, abnormal }: Props) {
  const normalizedValue = (value || "").trim().match(TIME_RESULT_PATTERN) ? value : toCanonicalTimeResult(value);
  const m = (normalizedValue || "").trim().match(TIME_RESULT_PATTERN);
  const min = m ? parseInt(m[1], 10) : 0;
  const sec = m ? parseInt(m[2], 10) : 0;

  const update = (newMin: number | string, newSec: number | string) => {
    const mn = newMin === "" ? "" : Math.max(0, Math.floor(Number(newMin) || 0));
    const sc = newSec === "" ? "" : Math.max(0, Math.floor(Number(newSec) || 0));
    if (mn === "" && sc === "") {
      onChange("");
      return;
    }
    onChange(buildCanonicalTime(mn === "" ? 0 : mn, sc === "" ? 0 : sc));
  };

  const cls = `h-7 text-sm w-[60px] text-center ${abnormal ? "border-destructive text-destructive font-bold" : ""}`;

  return (
    <div className={`flex items-center gap-1 ${className || ""}`} data-result-input="" data-result-value={normalizedValue || ""}>
      <Input
        type="number"
        min={0}
        value={normalizedValue && m ? min : ""}
        placeholder="min"
        className={cls}
        onChange={(e) => update(e.target.value, sec)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      <span className="font-bold text-muted-foreground">:</span>
      <Input
        type="number"
        min={0}
        max={59}
        value={normalizedValue && m ? sec : ""}
        placeholder="sec"
        className={cls}
        onChange={(e) => update(min, e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
    </div>
  );
}
