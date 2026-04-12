ALTER TABLE public.webhook_messages ADD COLUMN is_read boolean NOT NULL DEFAULT false;

-- Mark all existing messages as read
UPDATE public.webhook_messages SET is_read = true;