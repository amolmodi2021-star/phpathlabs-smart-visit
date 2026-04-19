ALTER TABLE public.message_send_log
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;