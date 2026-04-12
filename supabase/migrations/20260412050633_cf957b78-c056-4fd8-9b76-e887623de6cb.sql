
ALTER TABLE public.message_send_log ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE public.message_send_log ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'sent';
