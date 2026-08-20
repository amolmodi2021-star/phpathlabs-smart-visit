-- Per-page snip zoom (% width) for outsourced letterhead preview + report PDF.
ALTER TABLE public.outsourced_test_snips
  ADD COLUMN IF NOT EXISTS snip_page_scales jsonb DEFAULT NULL;

COMMENT ON COLUMN public.outsourced_test_snips.snip_page_scales IS
  'Array of page width percentages aligned with snip_image_urls order.';