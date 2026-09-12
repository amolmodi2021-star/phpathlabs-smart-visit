import { supabase } from "@/integrations/supabase/client";

/** Current on-screen JPEG capture (html-to-image + jsPDF). */
export const REPORT_PDF_ENGINE_JPEG = "screen_jpeg" as const;
/** Chromium print PDF — vector text, identical CSS layout/colors when service is up. */
export const REPORT_PDF_ENGINE_CHROMIUM = "chromium_print" as const;

export type ReportPdfEngine =
  | typeof REPORT_PDF_ENGINE_JPEG
  | typeof REPORT_PDF_ENGINE_CHROMIUM;

export const REPORT_PDF_ENGINE_SETTING_KEY = "report_pdf_engine";

const LABEL: Record<ReportPdfEngine, string> = {
  screen_jpeg: "Screen JPEG (current)",
  chromium_print: "Chromium print (native PDF)",
};

export function reportPdfEngineLabel(engine: ReportPdfEngine): string {
  return LABEL[engine] || engine;
}

export function normalizeReportPdfEngine(raw: string | null | undefined): ReportPdfEngine {
  const v = String(raw || "").trim();
  if (v === REPORT_PDF_ENGINE_CHROMIUM) return REPORT_PDF_ENGINE_CHROMIUM;
  return REPORT_PDF_ENGINE_JPEG;
}

let cached: ReportPdfEngine | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export function clearReportPdfEngineCache() {
  cached = null;
  cachedAt = 0;
}

export async function getReportPdfEngine(): Promise<ReportPdfEngine> {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", REPORT_PDF_ENGINE_SETTING_KEY)
    .maybeSingle();
  if (error) {
    console.warn("getReportPdfEngine:", error.message);
    return REPORT_PDF_ENGINE_JPEG;
  }
  cached = normalizeReportPdfEngine((data as any)?.setting_value);
  cachedAt = Date.now();
  return cached;
}

export async function setReportPdfEngine(engine: ReportPdfEngine): Promise<void> {
  const value = normalizeReportPdfEngine(engine);
  const { error } = await supabase.from("app_settings").upsert(
    {
      setting_key: REPORT_PDF_ENGINE_SETTING_KEY,
      setting_value: value,
      updated_at: new Date().toISOString(),
    } as any,
    { onConflict: "setting_key" },
  );
  if (error) throw error;
  cached = value;
  cachedAt = Date.now();
}