-- Google review WhatsApp: one delayed text per registration, claimed after next_retry_at.

INSERT INTO public.message_templates (template_key, template_value)
VALUES (
  'google_review_request',
  E'Dear {title} {patient_name},\n\nThank you for choosing PH PathLabs. Your reports for invoice {invoice_number} have been sent.\n\nIf you were happy with our service, please rate us on Google:\nPASTE_GOOGLE_REVIEW_LINK_HERE\n\nPH PathLabs\nLabLine: 6356 55 66 99'
)
ON CONFLICT (template_key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_outbox_one_google_review
  ON public.whatsapp_console_outbox (registration_id)
  WHERE kind = 'text'
    AND status IN ('pending', 'claimed', 'sent')
    AND registration_id IS NOT NULL
    AND (payload ->> 'source') = 'google_review_request';

-- Wake WhatsApp Console when a delayed row (review request or retry backoff) becomes due.
CREATE OR REPLACE FUNCTION public.promote_due_whatsapp_outbox()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promoted integer := 0;
BEGIN
  UPDATE public.whatsapp_console_outbox
  SET next_retry_at = NULL,
      updated_at = now()
  WHERE status = 'pending'
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= now();
  GET DIAGNOSTICS promoted = ROW_COUNT;
  RETURN promoted;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_due_whatsapp_outbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_due_whatsapp_outbox() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('promote-due-whatsapp-outbox');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'promote-due-whatsapp-outbox',
      '* * * * *',
      $cron$SELECT public.promote_due_whatsapp_outbox()$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;