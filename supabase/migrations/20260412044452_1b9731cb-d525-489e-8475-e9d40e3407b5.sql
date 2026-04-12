
ALTER TABLE public.webhook_messages
  ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS location_lat numeric,
  ADD COLUMN IF NOT EXISTS location_lng numeric,
  ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS error_info jsonb;

CREATE INDEX IF NOT EXISTS idx_webhook_messages_message_id ON public.webhook_messages (message_id);
CREATE INDEX IF NOT EXISTS idx_webhook_messages_sender_number ON public.webhook_messages (sender_number);
CREATE INDEX IF NOT EXISTS idx_webhook_messages_direction ON public.webhook_messages (direction);

ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_messages;
