-- Persist pickup-point manual age (no DOB) for invoices + reports.
ALTER TABLE public.patient_registrations
  ADD COLUMN IF NOT EXISTS age_text text;

ALTER TABLE public.approved_reports
  ADD COLUMN IF NOT EXISTS age_text text;

COMMENT ON COLUMN public.patient_registrations.age_text IS
  'Free-text age for pickup_point registrations (DOB optional/absent). Displayed on invoice/report.';
COMMENT ON COLUMN public.approved_reports.age_text IS
  'Snapshot of patient_registrations.age_text at approval time.';

CREATE OR REPLACE FUNCTION public.register_patient_atomic(
  p_registration jsonb,
  p_tubes jsonb DEFAULT '[]'::jsonb,
  p_payment jsonb DEFAULT NULL,
  p_home_visit_id uuid DEFAULT NULL,
  p_home_visit_patch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg public.patient_registrations%ROWTYPE;
  v_tube jsonb;
  v_uid text;
  v_sign numeric := 1;
  v_invoice text;
  v_umr text;
  v_visit text;
BEGIN
  IF p_registration IS NULL OR jsonb_typeof(p_registration) <> 'object' THEN
    RAISE EXCEPTION 'p_registration is required';
  END IF;

  v_invoice := public.generate_invoice_number();

  v_visit := COALESCE(NULLIF(btrim(p_registration->>'visit_type'), ''), 'lab_visit');
  v_umr := NULLIF(btrim(COALESCE(p_registration->>'umr_number', '')), '');

  IF v_visit = 'pickup_point' THEN
    v_umr := NULL;
  ELSIF v_umr IS NULL THEN
    v_umr := public.generate_umr_number();
  END IF;

  INSERT INTO public.patient_registrations (
    invoice_number,
    mobile_number,
    patient_name,
    title,
    gender,
    dob,
    age_text,
    email,
    address,
    doctor_name,
    umr_number,
    visit_type,
    pickup_point_id,
    channel_id,
    tests,
    gross_amount,
    discount_amount,
    net_amount,
    home_visit_charges,
    final_amount,
    payments,
    paid_amount,
    due_amount,
    global_discount_type,
    global_discount_value,
    status,
    home_visit_id,
    remarks,
    is_stat,
    report_language,
    registered_by
  ) VALUES (
    v_invoice,
    COALESCE(p_registration->>'mobile_number', ''),
    COALESCE(p_registration->>'patient_name', ''),
    NULLIF(p_registration->>'title', ''),
    NULLIF(p_registration->>'gender', ''),
    NULLIF(p_registration->>'dob', '')::date,
    NULLIF(btrim(COALESCE(p_registration->>'age_text', '')), ''),
    NULLIF(p_registration->>'email', ''),
    COALESCE(p_registration->>'address', ''),
    COALESCE(NULLIF(p_registration->>'doctor_name', ''), 'SELF'),
    v_umr,
    v_visit,
    NULLIF(p_registration->>'pickup_point_id', '')::uuid,
    NULLIF(p_registration->>'channel_id', '')::uuid,
    COALESCE(p_registration->'tests', '[]'::jsonb),
    COALESCE((p_registration->>'gross_amount')::numeric, 0),
    COALESCE((p_registration->>'discount_amount')::numeric, 0),
    COALESCE((p_registration->>'net_amount')::numeric, 0),
    COALESCE((p_registration->>'home_visit_charges')::numeric, 0),
    COALESCE((p_registration->>'final_amount')::numeric, 0),
    COALESCE(p_registration->'payments', '[]'::jsonb),
    COALESCE((p_registration->>'paid_amount')::numeric, 0),
    COALESCE((p_registration->>'due_amount')::numeric, 0),
    NULLIF(p_registration->>'global_discount_type', ''),
    COALESCE((p_registration->>'global_discount_value')::numeric, 0),
    COALESCE(NULLIF(p_registration->>'status', ''), 'registered'),
    COALESCE(NULLIF(p_registration->>'home_visit_id', '')::uuid, p_home_visit_id),
    NULLIF(p_registration->>'remarks', ''),
    COALESCE((p_registration->>'is_stat')::boolean, false),
    COALESCE(NULLIF(p_registration->>'report_language', ''), 'ENGLISH'),
    NULLIF(p_registration->>'registered_by', '')
  )
  RETURNING * INTO v_reg;

  FOR v_tube IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_tubes, '[]'::jsonb))
  LOOP
    v_uid := public.generate_sample_uid();
    INSERT INTO public.sample_tubes (
      sample_uid,
      registration_id,
      tube_type,
      tube_color,
      sample_type,
      suffix,
      test_ids,
      test_names,
      status
    ) VALUES (
      v_uid,
      v_reg.id,
      NULLIF(v_tube->>'tube_type', ''),
      NULLIF(v_tube->>'tube_color', ''),
      NULLIF(v_tube->>'sample_type', ''),
      COALESCE(v_tube->>'suffix', ''),
      COALESCE(v_tube->'test_ids', '[]'::jsonb),
      COALESCE(v_tube->'test_names', '[]'::jsonb),
      COALESCE(NULLIF(v_tube->>'status', ''), 'pending')
    );
  END LOOP;

  IF p_payment IS NOT NULL AND jsonb_typeof(p_payment) = 'object' THEN
    IF COALESCE(p_payment->>'direction', 'in') = 'out' THEN
      v_sign := -1;
    END IF;

    INSERT INTO public.payment_transactions (
      registration_id,
      invoice_number,
      patient_name,
      transaction_type,
      transaction_date,
      performed_by,
      cash_amount,
      gpay_amount,
      paytm_amount,
      credit_card_amount,
      neft_amount,
      total_amount,
      direction,
      gross_amount,
      discount_amount,
      final_amount,
      paid_amount,
      due_amount,
      refund_amount,
      remarks
    ) VALUES (
      v_reg.id,
      v_reg.invoice_number,
      COALESCE(NULLIF(p_payment->>'patient_name', ''), v_reg.patient_name),
      COALESCE(NULLIF(p_payment->>'transaction_type', ''), 'registration_payment'),
      COALESCE(NULLIF(p_payment->>'transaction_date', '')::timestamptz, now()),
      NULLIF(p_payment->>'performed_by', ''),
      COALESCE((p_payment->>'cash_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'gpay_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'paytm_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'credit_card_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'neft_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'total_amount')::numeric, 0) * v_sign,
      COALESCE(NULLIF(p_payment->>'direction', ''), 'in'),
      COALESCE((p_payment->>'gross_amount')::numeric, v_reg.gross_amount),
      COALESCE((p_payment->>'discount_amount')::numeric, v_reg.discount_amount),
      COALESCE((p_payment->>'final_amount')::numeric, v_reg.final_amount),
      COALESCE((p_payment->>'paid_amount')::numeric, v_reg.paid_amount),
      COALESCE((p_payment->>'due_amount')::numeric, v_reg.due_amount),
      COALESCE((p_payment->>'refund_amount')::numeric, 0),
      NULLIF(p_payment->>'remarks', '')
    );
  END IF;

  IF p_home_visit_id IS NOT NULL THEN
    UPDATE public.home_visits hv
    SET
      status = COALESCE(NULLIF(p_home_visit_patch->>'status', ''), 'Registered'),
      address = COALESCE(NULLIF(p_home_visit_patch->>'address', ''), hv.address),
      payment_mode = CASE
        WHEN p_home_visit_patch ? 'payment_mode' THEN NULLIF(p_home_visit_patch->>'payment_mode', '')
        ELSE hv.payment_mode
      END,
      paid_amount = CASE
        WHEN p_home_visit_patch ? 'paid_amount' THEN COALESCE((p_home_visit_patch->>'paid_amount')::numeric, hv.paid_amount)
        ELSE hv.paid_amount
      END,
      due_amount = CASE
        WHEN p_home_visit_patch ? 'due_amount' THEN COALESCE((p_home_visit_patch->>'due_amount')::numeric, hv.due_amount)
        ELSE hv.due_amount
      END,
      updated_at = now()
    WHERE hv.id = p_home_visit_id;
  END IF;

  RETURN to_jsonb(v_reg);
END;
$$;

REVOKE ALL ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) TO service_role;