import { useRef, useLayoutEffect, useState, ReactNode } from "react";

interface AutoScaleContentProps {
  maxHeightMm?: number;
  /** Fill the parent flex slot (histogram page). Uses the real height above the signature. */
  fillParent?: boolean;
  children: ReactNode;
}

/**
 * Measures its children and applies a uniform CSS scale so content fits a height cap.
 * Used for CBC / Urine Routine pages (maxHeightMm) and CBC histograms (fillParent).
 */
const AutoScaleContent = ({ maxHeightMm, fillParent, children }: AutoScaleContentProps) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const measure = () => {
      if (!innerRef.current || !outerRef.current) return;
      const contentH = innerRef.current.scrollHeight;
      const mmPx = maxHeightMm != null && maxHeightMm > 0 ? (maxHeightMm / 25.4) * 96 : Number.POSITIVE_INFINITY;
      const slotPx = fillParent ? outerRef.current.clientHeight : mmPx;
      if (fillParent) {
        // Always leave ~10% unused so charts are not flush with the signature.
        const fitPx = Math.max(1, (slotPx > 1 ? slotPx : mmPx) * 0.9);
        if (contentH > 1) setScale(Math.max(0.55, Math.min(1, fitPx / contentH)));
        else setScale(1);
        return;
      }
      const maxPx = mmPx;
      if (!(maxPx > 1) || !(contentH > 1)) {
        setScale(1);
        return;
      }
      if (contentH > maxPx) {
        setScale(Math.max(0.65, maxPx / contentH));
      } else {
        setScale(1);
      }
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const outer = outerRef.current;
    const inner = innerRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && outer) ro.observe(outer);
    if (ro && inner) ro.observe(inner);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [maxHeightMm, fillParent, children]);

  return (
    <div
      ref={outerRef}
      style={
        fillParent
          ? { height: "100%", minHeight: 0, overflow: "hidden" }
          : { overflow: "hidden", maxHeight: `${maxHeightMm}mm` }
      }
    >
      <div
        ref={innerRef}
        style={{
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
          width: scale !== 1 ? `${100 / scale}%` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default AutoScaleContent;
