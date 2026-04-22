-- Speeds up CRMSentHistory ORDER BY last_sent_date DESC NULLS LAST WHERE last_sent_date IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_crm_contacts_last_sent_date
  ON public.crm_contacts (last_sent_date DESC NULLS LAST)
  WHERE last_sent_date IS NOT NULL;

-- Speeds up the drip preflight dedupe lookup (filter + mobile + status, ordered by created_at)
CREATE INDEX IF NOT EXISTS idx_drip_campaign_log_filter_mobile_status
  ON public.drip_campaign_log (filter_id, mobile_number, status, created_at DESC);
