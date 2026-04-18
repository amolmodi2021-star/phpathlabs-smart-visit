import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Inline type-ahead descriptive combobox with auto-growing textarea.
// - Typing filters the option list AND saves the value (free-text editable).
// - ↑/↓ navigates, Enter selects, Esc closes, Tab passes through to onKeyDown.
// - Field grows vertically so long selected/edited text is fully visible.

export interface DescriptiveComboboxProps {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
}

export const DescriptiveCombobox = ({
  value,
  options,
  onChange,
  onKeyDown,
  className,
  placeholder,
}: DescriptiveComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(filtered.length > 0 ? 0 : -1);
  }, [filtered.length, value]);

  // Auto-scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelectorAll<HTMLLIElement>("li")[highlightedIndex];
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  // Auto-grow textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 28)}px`;
  }, [value]);

  const selectOption = (opt: string) => {
    onChange(opt);
    setOpen(false);
    setHighlightedIndex(-1);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
        return;
      }
      if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        selectOption(filtered[highlightedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    // Prevent newline insertion in single-cell semantics — Enter passes through to onKeyDown
    if (e.key === "Enter") {
      e.preventDefault();
    }
    if (e.key === "Tab") {
      setOpen(false);
    }
    onKeyDown?.(e);
  };

  return (
    <div className={cn("relative", className)}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Type to search..."}
        className="flex w-full min-h-[28px] resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-input bg-background px-3 py-1 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        data-result-input=""
        data-result-value={value || ""}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute top-full left-0 mt-1 w-full max-h-60 overflow-y-auto z-50 bg-popover border border-border rounded-md shadow-md py-1"
          onMouseDown={(e) => {
            // Prevent textarea blur before click registers
            e.preventDefault();
            if (blurTimerRef.current) {
              window.clearTimeout(blurTimerRef.current);
              blurTimerRef.current = null;
            }
          }}
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt}
              onClick={() => selectOption(opt)}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={cn(
                "px-2 py-1.5 text-sm cursor-pointer whitespace-normal",
                idx === highlightedIndex ? "bg-accent text-accent-foreground" : "text-popover-foreground",
              )}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DescriptiveCombobox;
