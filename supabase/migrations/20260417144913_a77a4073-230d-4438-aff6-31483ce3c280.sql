ALTER TABLE public.message_send_log
  ADD COLUMN IF NOT EXISTS retry_payload jsonb,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_message_send_log_retry
  ON public.message_send_log (message_type, delivery_status, retry_count, sent_at DESC);