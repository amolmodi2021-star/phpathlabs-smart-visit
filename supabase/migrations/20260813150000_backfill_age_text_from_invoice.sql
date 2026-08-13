-- Backfill null age_text from DOB as of bill/registration date (invoice YYMMDD prefix).
-- Invoice format: YYMMDD + seq (Asia/Kolkata), e.g. 2608130011 → 2026-08-13.

CREATE OR REPLACE FUNCTION public.invoice_reg_date(p_invoice text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_invoice ~ '^[0-9]{6}' THEN
      to_date(
        CASE
          WHEN substring(p_invoice from 1 for 2)::int >= 70 THEN '19'
          ELSE '20'
        END || substring(p_invoice from 1 for 6),
        'YYYYMMDD'
      )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.age_text_from_dob_as_of(p_dob date, p_as_of date)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  y int;
  m int;
  months int;
BEGIN
  IF p_dob IS NULL OR p_as_of IS NULL THEN
    RETURN NULL;
  END IF;
  y := EXTRACT(YEAR FROM age(p_as_of, p_dob))::int;
  IF y < 1 THEN
    months := (EXTRACT(YEAR FROM age(p_as_of, p_dob))::int * 12)
      + EXTRACT(MONTH FROM age(p_as_of, p_dob))::int;
    RETURN greatest(months, 0)::text || ' months';
  END IF;
  RETURN y::text || ' Years';
END;
$$;

-- approved_reports snapshot (reports PDF source of truth)
UPDATE public.approved_reports ar
SET age_text = public.age_text_from_dob_as_of(
  ar.dob::date,
  COALESCE(
    public.invoice_reg_date(ar.invoice_number),
    (ar.registration_date AT TIME ZONE 'Asia/Kolkata')::date,
    (ar.approval_date AT TIME ZONE 'Asia/Kolkata')::date
  )
)
WHERE ar.age_text IS NULL
  AND ar.dob IS NOT NULL;

-- patient_registrations (registration / invoice completeness)
UPDATE public.patient_registrations pr
SET age_text = public.age_text_from_dob_as_of(
  pr.dob::date,
  COALESCE(
    public.invoice_reg_date(pr.invoice_number),
    (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date
  )
)
WHERE pr.age_text IS NULL
  AND pr.dob IS NOT NULL;