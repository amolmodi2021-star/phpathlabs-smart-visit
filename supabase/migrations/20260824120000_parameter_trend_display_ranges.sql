-- Trend-only normal range display (does not change parameter clinical ranges).
ALTER TABLE public.report_test_parameters
  ADD COLUMN IF NOT EXISTS trend_display_low numeric,
  ADD COLUMN IF NOT EXISTS trend_display_high numeric,
  ADD COLUMN IF NOT EXISTS trend_display_label text;

COMMENT ON COLUMN public.report_test_parameters.trend_display_low IS
  'Optional low bound shown on Historical Trends graphs only';
COMMENT ON COLUMN public.report_test_parameters.trend_display_high IS
  'Optional high bound shown on Historical Trends graphs only';
COMMENT ON COLUMN public.report_test_parameters.trend_display_label IS
  'Short range label under trend points (e.g. 0 - 5.6 %). Clinical ranges unchanged.';