-- Realtime outbox: retry scheduling + publish for WhatsApp Console push delivery
ALTER TABLE public.whatsapp_console_outbox
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8;

CREATE INDEX IF NOT EXISTS idx_wa_console_outbox_retry
  ON public.whatsapp_console_outbox (status, next_retry_at, created_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.whatsapp_console_outbox.next_retry_at IS
  'When status=pending, Console may claim only if null or <= now() (backoff for failed retries).';

-- Enable Supabase Realtime so WhatsApp Console can wake immediately on new/retry pending rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_console_outbox'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_console_outbox;
  END IF;
END $$;

ALTER TABLE public.whatsapp_console_outbox REPLICA IDENTITY FULL;