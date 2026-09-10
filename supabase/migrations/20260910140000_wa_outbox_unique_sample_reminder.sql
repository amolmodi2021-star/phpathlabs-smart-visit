-- Prevent two in-flight sample-collection reminder WhatsApps for the same registration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_outbox_one_open_sample_reminder
  ON public.whatsapp_console_outbox (registration_id)
  WHERE kind = 'text'
    AND status IN ('pending', 'claimed')
    AND registration_id IS NOT NULL
    AND (payload ->> 'source') = 'pending_sample_collection_reminder';

