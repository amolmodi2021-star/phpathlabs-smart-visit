-- Pending sample-collection WhatsApp reminder: send count + configurable template.

ALTER TABLE public.patient_registrations
  ADD COLUMN IF NOT EXISTS sample_collection_reminder_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_collection_reminder_last_sent_at timestamptz NULL;

COMMENT ON COLUMN public.patient_registrations.sample_collection_reminder_sent_count IS
  'How many times a pending sample-collection WhatsApp reminder was queued for this registration.';
COMMENT ON COLUMN public.patient_registrations.sample_collection_reminder_last_sent_at IS
  'When the last pending sample-collection WhatsApp reminder was queued.';

INSERT INTO public.message_templates (template_key, template_value)
VALUES (
  'pending_sample_collection_reminder',
  E'Dear {patient_name},\n\nSample collection is still pending for the following test(s) (Invoice {invoice_number}):\n\n{test_list}\n\nPlease visit the lab / arrange collection at the earliest.\n\nPH PathLabs\nLabLine: 6356 55 66 99'
)
ON CONFLICT (template_key) DO NOTHING;