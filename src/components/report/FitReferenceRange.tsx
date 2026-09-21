import { useLayoutEffect, useRef, useState } from "react";

const MIN_SCALE = 0.62;

/** Keep Test Management line breaks; never wrap a line (units stay with that line). */
export function referenceRangeLines(text: string): string[] {
  return String(text ?? "").split(/\r\n|\n|\r/);
}

/**
 * Reference Range cell: each stored line stays on one line.
 * If the longest line is wider than the column, shrink the whole range uniformly.
 */
export default function FitReferenceRange({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const lines = referenceRangeLines(text);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const fit = () => {
      const avail = box.clientWidth;
      if (avail < 8) return;
      box.style.fontSize = "1em";
      let longest = 0;
      box.querySelectorAll<HTMLElement>("[data-ref-line]").forEach((n) => {
        longest = Math.max(longest, n.scrollWidth);
      });
      if (longest <= 0) {
        setScale(1);
        return;
      }
      const next = longest > avail + 0.5 ? Math.max(MIN_SCALE, avail / longest) : 1;
      box.style.fontSize = `${next}em`;
      setScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };

    fit();
    const parent = box.parentElement;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (parent) ro?.observe(parent);
    return () => ro?.disconnect();
  }, [text]);

  return (
    <div ref={boxRef} style={{ width: "100%", minWidth: 0, fontSize: `${scale}em` }}>
      {lines.map((line, i) => (
        <div
          key={i}
          data-ref-line
          style={{
            whiteSpace: "nowrap",
            wordBreak: "keep-all",
            overflowWrap: "normal",
            lineHeight: 1.25,
          }}
        >
          {line.length ? line : "\u00a0"}
        </div>
      ))}
    </div>
  );
}