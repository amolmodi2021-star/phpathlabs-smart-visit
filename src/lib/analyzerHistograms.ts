export type AnalyzerHistogram = {
  kind: "WBC" | "RBC" | "PLT" | string;
  bins: number[];
  discriminators?: number[] | null;
  x_min?: number | null;
  x_max?: number | null;
  x_label?: string | null;
  estimated?: boolean | null;
  source?: string | null;
  sample_id?: string | null;
};

const KIND_ORDER = ["WBC", "RBC", "PLT"];

export function normalizeHistogramRows(raw: unknown): AnalyzerHistogram[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalyzerHistogram[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = String((item as any).kind || "").trim().toUpperCase();
    if (!KIND_ORDER.includes(kind)) continue;
    const bins = Array.isArray((item as any).bins)
      ? (item as any).bins.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
      : [];
    if (bins.length < 10) continue;
    out.push({
      kind,
      bins,
      discriminators: Array.isArray((item as any).discriminators)
        ? (item as any).discriminators.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
        : null,
      x_min: (item as any).x_min ?? null,
      x_max: (item as any).x_max ?? null,
      x_label: (item as any).x_label ?? null,
      estimated: !!(item as any).estimated,
      source: (item as any).source ?? null,
      sample_id: (item as any).sample_id ?? null,
    });
  }
  return out;
}

export function mergeHistogramSnapshots(
  existing: AnalyzerHistogram[],
  incoming: AnalyzerHistogram[],
): AnalyzerHistogram[] {
  const byKind = new Map<string, AnalyzerHistogram>();
  for (const item of existing) byKind.set(String(item.kind).toUpperCase(), item);
  for (const item of incoming) {
    const key = String(item.kind).toUpperCase();
    if (!byKind.has(key)) byKind.set(key, item);
  }
  return KIND_ORDER.map((kind) => byKind.get(kind)).filter(Boolean) as AnalyzerHistogram[];
}

export function hasRenderableHistograms(histograms: AnalyzerHistogram[] | null | undefined): boolean {
  /**
   * PDF safety net: show CBC histograms only when WBC, RBC, and PLT are all present.
   * A partial set (e.g. PLT-only) must not appear on the report.
   */
  const rows = histograms || [];
  const byKind = new Map<string, AnalyzerHistogram>();
  for (const item of rows) {
    const kind = String(item.kind || "").trim().toUpperCase();
    if (!KIND_ORDER.includes(kind)) continue;
    if (!Array.isArray(item.bins) || item.bins.length < 10) continue;
    byKind.set(kind, item);
  }
  return KIND_ORDER.every((kind) => byKind.has(kind));
}

/** Persist missing live histogram kinds onto approved_reports.histograms. */
export async function healApprovedReportHistograms(
  supabase: { from: (table: string) => any; rpc?: (fn: string, args: Record<string, any>) => any },
  registrationId: string,
): Promise<number> {
  if (!registrationId) return 0;
  if (typeof (supabase as any).rpc === "function") {
    const { data, error } = await (supabase as any).rpc("lims_heal_approved_report_histograms", {
      p_registration_id: registrationId,
    });
    if (!error) return Number(data ?? 0);
  }

  const [{ data: report }, { data: liveRows }] = await Promise.all([
    supabase.from("approved_reports").select("histograms").eq("registration_id", registrationId).maybeSingle(),
    supabase
      .from("analyzer_histograms")
      .select("kind, bins, discriminators, x_min, x_max, x_label, estimated, source, sample_id")
      .eq("registration_id", registrationId),
  ]);
  if (!report) return 0;
  const existing = normalizeHistogramRows(report.histograms);
  const live = normalizeHistogramRows(liveRows);
  const merged = mergeHistogramSnapshots(existing, live);
  if (merged.length <= existing.length) return 0;
  await supabase
    .from("approved_reports")
    .update({ histograms: merged } as any)
    .eq("registration_id", registrationId);
  return merged.length - existing.length;
}
