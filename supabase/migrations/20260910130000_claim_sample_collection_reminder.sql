-- Atomic claim for pending sample-collection WhatsApp reminders (prevents double-send across PCs).

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
  v_now timestamptz := now();
BEGIN
  SELECT pr.sample_collection_reminder_sent_count, pr.sample_collection_reminder_last_sent_at
  INTO v_count, v_last
  FROM public.patient_registrations pr
  WHERE pr.id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::timestamptz, NULL::timestamptz, 'Registration not found'::text;
    RETURN;
  END IF;

  v_count := COALESCE(v_count, 0);

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

CREATE OR REPLACE FUNCTION public.release_sample_collection_reminder_claim(
  p_registration_id uuid,
  p_expected_count integer,
  p_claimed_last_sent_at timestamptz,
  p_previous_last_sent_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.patient_registrations
  SET
    sample_collection_reminder_sent_count = GREATEST(p_expected_count - 1, 0),
    sample_collection_reminder_last_sent_at = p_previous_last_sent_at,
    updated_at = now()
  WHERE id = p_registration_id
    AND sample_collection_reminder_sent_count = p_expected_count
    AND sample_collection_reminder_last_sent_at IS NOT DISTINCT FROM p_claimed_last_sent_at;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_sample_collection_reminder(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_sample_collection_reminder_claim(uuid, integer, timestamptz, timestamptz) TO anon, authenticated, service_role;

