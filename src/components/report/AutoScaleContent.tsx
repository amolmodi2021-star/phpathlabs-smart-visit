import { useRef, useEffect, useState, ReactNode } from "react";

interface AutoScaleContentProps {
  maxHeightMm: number;
  children: ReactNode;
}

/**
 * Measures its children and applies CSS scale-down if they exceed maxHeightMm.
 * Used for CBC / Urine Routine pages that must fit on a single page.
 */
const AutoScaleContent = ({ maxHeightMm, children }: AutoScaleContentProps) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      if (!innerRef.current || !outerRef.current) return;
      const contentH = innerRef.current.scrollHeight;
      const maxPx = (maxHeightMm / 25.4) * 96; // mm → px at 96 dpi
      if (contentH > maxPx) {
        const newScale = Math.max(0.65, maxPx / contentH); // floor at 65%
        setScale(newScale);
      } else {
        setScale(1);
      }
    };

    // Delay measurement to allow rendering
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(measure);
    });
    return () => cancelAnimationFrame(raf);
  }, [maxHeightMm, children]);

  return (
    <div ref={outerRef} style={{ overflow: "hidden", maxHeight: `${maxHeightMm}mm` }}>
      <div
        ref={innerRef}
        style={{
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
          width: scale < 1 ? `${100 / scale}%` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default AutoScaleContent;
