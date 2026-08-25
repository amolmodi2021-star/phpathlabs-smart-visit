import React from "react";
import type { AnalyzerHistogram } from "@/lib/analyzerHistograms";
import { hasRenderableHistograms } from "@/lib/analyzerHistograms";
import {
  debugHistogramXMapping,
  histogramPlotY,
  histogramScaleForKind,
  isInteriorDiscriminator,
  XP_HISTOGRAM_SCALE,
} from "@/lib/histogramPlotX";

export type { AnalyzerHistogram };
export { hasRenderableHistograms };

const KIND_COLORS: Record<string, string> = {
  WBC: "#1e60a8",
  RBC: "#b42828",
  PLT: "#c47814",
};

interface HistogramSvgProps extends AnalyzerHistogram {
  color: string;
  /** Omit under-curve shade for print / PDF capture. */
  hideFill?: boolean;
}

const CURVE_STROKE = 1.6;

const HistogramSvg = ({ kind, bins, discriminators, estimated, color, hideFill }: HistogramSvgProps) => {
  const width = 640;
  const height = 200;
  const left = 28;
  const right = width - 86;
  const top = 10;
  const bottom = height - 28;
  const plotW = right - left;
  const plotH = bottom - top;
  const values = (bins || []).map((v) => Math.max(0, Number(v) || 0));
  const peak = Math.max(...values, 1);
  const n = values.length;
  const spec = XP_HISTOGRAM_SCALE[String(kind).toUpperCase() as keyof typeof XP_HISTOGRAM_SCALE];
  const ticks = spec?.ticks || [];
  const minorTicks = spec?.minorTicks || [];
  const xlabel = spec?.label || "Volume (fL)";
  const scale = histogramScaleForKind(kind, n, left, plotW);

  React.useEffect(() => {
    debugHistogramXMapping({ kind: String(kind), scale, discriminators });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, n, JSON.stringify(discriminators || [])]);

  const yAt = (heightValue: number) =>
    histogramPlotY({
      value: heightValue,
      peak,
      plotTop: top,
      plotBottom: bottom,
    });

  const points = values.map((heightValue, index) => {
    const x = scale.plotX(scale.channelToFl(index));
    const y = yAt(heightValue);
    return `${x},${y}`;
  });
  const minX = scale.plotX(scale.xMin);
  const maxX = scale.plotX(scale.xMax);
  const curvePoints = [...points];
  if (curvePoints.length) {
    const last = curvePoints[curvePoints.length - 1];
    const sep = last.indexOf(",");
    const lastX = Number(last.slice(0, sep));
    const lastY = last.slice(sep + 1);
    if (lastX < maxX) curvePoints.push(`${maxX},${lastY}`);
  }
  const area = [`${minX},${bottom}`, ...curvePoints, `${maxX},${bottom}`].join(" ");

  return (
    <div className="border border-gray-200 rounded bg-white">
        <div className="px-2 pt-1 pb-0.5 text-[16px] font-semibold leading-none" style={{ color: "#212529" }}>
          {kind}{estimated ? " (estimated)" : ""}
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="42mm"
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          style={{ display: "block", width: "100%", height: "42mm" }}
        >
        {!hideFill ? (
          <polygon className="hist-fill" points={area} fill={color} fillOpacity="0.28" />
        ) : null}
        {curvePoints.length >= 2 && (
          <polyline
            points={curvePoints.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={CURVE_STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {(discriminators || []).map((channel, idx) => {
          const index = Number(channel);
          if (!Number.isFinite(index)) return null;
          const fl = scale.channelToFl(index);
          if (!isInteriorDiscriminator(fl, scale)) return null;
          const x = scale.plotX(fl);
          return <line key={idx} x1={x} y1={top} x2={x} y2={bottom} stroke="#787878" strokeWidth="1" />;
        })}

        <rect x={minX} y={top} width={maxX - minX} height={plotH} fill="none" stroke="#5a5a5a" strokeWidth="1" />

        {minorTicks.map((volume) => {
          const x = scale.plotX(volume);
          return <line key={`minor-${volume}`} x1={x} y1={bottom} x2={x} y2={bottom - 7} stroke="#5a5a5a" strokeWidth="1" />;
        })}

        {ticks.map((volume) => {
          const x = scale.plotX(volume);
          const isLast = volume === scale.xMax;
          return (
            <g key={volume}>
              <line x1={x} y1={bottom} x2={x} y2={bottom - 7} stroke="#5a5a5a" strokeWidth="1" />
              <text
                x={x}
                y={height - 6}
                fontSize="10"
                fill="#5a5a5a"
                textAnchor={isLast ? "end" : "middle"}
              >
                {volume}
              </text>
            </g>
          );
        })}

        <text x={width - 10} y={height - 6} fontSize="10" fill="#5a5a5a" textAnchor="end">
          {xlabel}
        </text>
      </svg>
    </div>
  );
};

export const isCbcTestName = (name: string): boolean => {
  const lower = (name || "").toLowerCase();
  return lower.includes("cbc") || lower.includes("complete blood count");
};

export const pageHasCbcTest = (testBlocks: { testName?: string }[] | undefined): boolean => {
  if (!testBlocks?.length) return false;
  return testBlocks.some((b) => isCbcTestName(b.testName || ""));
};

const CbcHistogramCharts = ({
  histograms,
  hideFill = false,
}: {
  histograms: AnalyzerHistogram[];
  /** Hide under-curve shade for print / PDF (React omit — CSS alone is unreliable in html-to-image). */
  hideFill?: boolean;
}) => {
  const order: Array<"WBC" | "RBC" | "PLT"> = ["WBC", "RBC", "PLT"];
  const byKind = Object.fromEntries(
    (histograms || []).map((h) => [String(h.kind).toUpperCase(), h]),
  );
  const visible = order.filter((kind) => (byKind[kind]?.bins?.length || 0) >= 10);
  if (visible.length === 0) return null;

  return (
    <div className="px-1 pb-2 print:break-inside-avoid" data-pdf-section="cbc-histograms" style={{ paddingBottom: "8mm" }}>
      <div className="font-semibold text-center mb-2" style={{ color: "#2E3192", fontSize: "18px" }}>
        CBC Histograms
      </div>
      <div className="space-y-2">
        {visible.map((kind) => (
          <HistogramSvg
            key={kind}
            {...byKind[kind]}
            kind={kind}
            color={KIND_COLORS[kind]}
            hideFill={hideFill}
          />
        ))}
      </div>
    </div>
  );
};

export default CbcHistogramCharts;
