-- One automatic retry only (attempt 1 + retry), then fail for manual Dispatch send.
ALTER TABLE public.whatsapp_console_outbox
  ALTER COLUMN max_attempts SET DEFAULT 2;

UPDATE public.whatsapp_console_outbox
SET max_attempts = 2
WHERE max_attempts IS DISTINCT FROM 2;

UPDATE public.whatsapp_console_outbox
SET
  status = 'failed',
  next_retry_at = NULL,
  claimed_at = NULL,
  claimed_by = NULL,
  updated_at = now(),
  last_error = COALESCE(NULLIF(last_error, ''), 'whatsapp_send_failed')
WHERE status IN ('pending', 'claimed')
  AND attempts >= 2;
