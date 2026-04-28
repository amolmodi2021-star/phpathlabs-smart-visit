-- Reclaim space and stop scans on unused drip tables
TRUNCATE TABLE public.drip_campaign_log;
TRUNCATE TABLE public.drip_mobile_cycles;

-- Index for the kept Estimates Dashboard query (status + date order)
CREATE INDEX IF NOT EXISTS idx_estimates_status_created
  ON public.estimates (status, created_at DESC);