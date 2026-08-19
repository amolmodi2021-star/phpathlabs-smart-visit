/**
 * One fL-to-pixel mapping for XP-300 histogram PDF rendering.
 *
 * Discriminator bytes are 1-based channel numbers into the same bin array.
 * Convert channel -> fL, then fL -> pixel with plotX(). Ticks are already fL.
 *
 *   channelToFl(i) = originFl + i * flPerChannel
 *   plotX(fl)      = plotLeft + (fl - xMin) / (xMax - xMin) * plotWidth
 *
 * WBC: 50 channels, 6 fL each, origin 6 fL (channels 1–50 on a 0–300 axis).
 * Discriminator 49 sits at 300 fL. PLT discriminator 29 sits at 30 fL.
 */

export type HistogramKind = "WBC" | "RBC" | "PLT";

export const XP_HISTOGRAM_SCALE: Record<
  HistogramKind,
  {
    xMin: number;
    xMax: number;
    originFl: number;
    flPerChannel: number;
    ticks: number[];
    minorTicks: number[];
    label: string;
  }
> = {
  WBC: {
    xMin: 0,
    xMax: 300,
    originFl: 6,
    flPerChannel: 6,
    ticks: [100, 200, 300],
    minorTicks: [50, 150, 250],
    label: "Volume (fL)",
  },
  RBC: {
    xMin: 0,
    xMax: 250,
    originFl: 5,
    flPerChannel: 5,
    ticks: [100, 200],
    minorTicks: [50, 150],
    label: "Volume (fL)",
  },
  PLT: {
    xMin: 0,
    xMax: 40,
    originFl: 1,
    flPerChannel: 1,
    ticks: [0, 10, 20, 30],
    minorTicks: [],
    label: "Volume (fL)",
  },
};

export type HistogramXScale = {
  xMin: number;
  xMax: number;
  originFl: number;
  flPerChannel: number;
  plotLeft: number;
  plotWidth: number;
  binCount: number;
  channelToFl: (index: number) => number;
  plotX: (fl: number) => number;
};

export function createHistogramXScale(opts: {
  binCount: number;
  xMin: number;
  xMax: number;
  originFl: number;
  flPerChannel: number;
  plotLeft: number;
  plotWidth: number;
}): HistogramXScale {
  const { binCount, xMin, xMax, originFl, flPerChannel, plotLeft, plotWidth } = opts;
  const range = xMax - xMin || 1;
  const plotX = (fl: number) => plotLeft + ((fl - xMin) / range) * plotWidth;
  const channelToFl = (index: number) => originFl + index * flPerChannel;
  return { xMin, xMax, originFl, flPerChannel, plotLeft, plotWidth, binCount, channelToFl, plotX };
}

/**
 * Auto-scale a bin onto the plot Y axis so the data peak never sits on the top frame.
 * Domain [0, peak] maps onto the lower `fillRatio` of the plot (default 75%).
 */
export function histogramPlotY(opts: {
  value: number;
  peak: number;
  plotTop: number;
  plotBottom: number;
  fillRatio?: number;
}): number {
  const peak = Math.max(opts.peak, 1);
  const value = Math.max(0, Number(opts.value) || 0);
  const fillRatio = opts.fillRatio ?? 0.75;
  const span = Math.max(1, (opts.plotBottom - opts.plotTop) * fillRatio);
  return opts.plotBottom - (value / peak) * span;
}

/** Draw any discriminator that falls on the plotted fL domain. */
export function isInteriorDiscriminator(fl: number, scale: HistogramXScale): boolean {
  if (!Number.isFinite(fl)) return false;
  return fl >= scale.xMin && fl <= scale.xMax;
}

export function histogramScaleForKind(
  kind: string,
  binCount: number,
  plotLeft: number,
  plotWidth: number,
): HistogramXScale {
  const spec = XP_HISTOGRAM_SCALE[String(kind).toUpperCase() as HistogramKind] || {
    xMin: 0,
    xMax: Math.max(binCount, 1),
    originFl: 0,
    flPerChannel: 1,
    ticks: [],
    minorTicks: [],
    label: "Channel",
  };
  return createHistogramXScale({
    binCount,
    xMin: spec.xMin,
    xMax: spec.xMax,
    originFl: spec.originFl,
    flPerChannel: spec.flPerChannel,
    plotLeft,
    plotWidth,
  });
}

export function debugHistogramXMapping(input: {
  kind: string;
  scale: HistogramXScale;
  discriminators?: number[] | null;
}): void {
  const { kind, scale, discriminators } = input;
  const last = Math.max(scale.binCount - 1, 0);
  console.info("[histogram-x]", {
    kind,
    xMin: scale.xMin,
    xMax: scale.xMax,
    originFl: scale.originFl,
    flPerChannel: scale.flPerChannel,
    plotLeft: scale.plotLeft,
    plotWidth: scale.plotWidth,
    firstCurveFl: scale.channelToFl(0),
    firstCurveX: scale.plotX(scale.channelToFl(0)),
    lastCurveFl: scale.channelToFl(last),
    lastCurveX: scale.plotX(scale.channelToFl(last)),
    minLabelX: scale.plotX(scale.xMin),
    maxLabelX: scale.plotX(scale.xMax),
    tick10or100X: scale.plotX(kind.toUpperCase() === "PLT" ? 10 : 100),
    discriminators: (discriminators || []).map((channel) => ({
      channel,
      fl: scale.channelToFl(channel),
      x: scale.plotX(scale.channelToFl(channel)),
    })),
  });
}
