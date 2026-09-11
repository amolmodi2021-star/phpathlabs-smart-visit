-- Exclude same-calendar-day (Asia/Kolkata) registrations from sample-collection WhatsApp claims.

CREATE OR REPLACE FUNCTION public.claim_sample_collection_reminder(p_registration_id uuid)
RETURNS TABLE (
  claimed boolean,
  sent_count integer,
  last_sent_at timestamptz,
  previous_last_sent_at timestamptz,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_last timestamptz;
  v_created timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT
    pr.sample_collection_reminder_sent_count,
    pr.sample_collection_reminder_last_sent_at,
    pr.created_at
  INTO v_count, v_last, v_created
  FROM public.patient_registrations pr
  WHERE pr.id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::timestamptz, NULL::timestamptz, 'Registration not found'::text;
    RETURN;
  END IF;

  v_count := COALESCE(v_count, 0);

  IF v_created IS NOT NULL
     AND (v_created AT TIME ZONE 'Asia/Kolkata')::date
         = (v_now AT TIME ZONE 'Asia/Kolkata')::date THEN
    RETURN QUERY SELECT false, v_count, v_last, v_last, 'Registered today — reminders start from the next day'::text;
    RETURN;
  END IF;

  IF v_count >= 2 THEN
    RETURN QUERY SELECT false, v_count, v_last, v_last, 'Maximum 2 reminders already sent'::text;
    RETURN;
  END IF;

  IF v_last IS NOT NULL AND v_last > (v_now - interval '3 days') THEN
    RETURN QUERY SELECT false, v_count, v_last, v_last, 'Already sent recently (wait 3 days) — refresh the list'::text;
    RETURN;
  END IF;

  UPDATE public.patient_registrations
  SET
    sample_collection_reminder_sent_count = v_count + 1,
    sample_collection_reminder_last_sent_at = v_now,
    updated_at = v_now
  WHERE id = p_registration_id;

  RETURN QUERY SELECT true, v_count + 1, v_now, v_last, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_sample_collection_reminder(uuid) TO anon, authenticated, service_role;