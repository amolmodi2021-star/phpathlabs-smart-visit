-- Invoice numbers were jumping (e.g. 2608090028 as "first" of day) because
-- invoice_counter can get ahead of real patient_registrations after production
-- imports or audit scripts that call generate_invoice_number without inserting.
-- Generate from the max existing invoice for the IST day, under an advisory lock.

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMMDD');
  max_existing integer;
  seq integer;
BEGIN
  -- Serialize per calendar day (IST key).
  PERFORM pg_advisory_xact_lock(87201409, hashtext(today));

  SELECT COALESCE(MAX(substring(invoice_number from 7 for 4)::integer), 0)
  INTO max_existing
  FROM public.patient_registrations
  WHERE invoice_number ~ ('^' || today || '[0-9]{4}$');

  seq := max_existing + 1;

  INSERT INTO public.invoice_counter (date_key, last_sequence)
  VALUES (today, seq)
  ON CONFLICT (date_key) DO UPDATE
  SET last_sequence = EXCLUDED.last_sequence;

  RETURN today || lpad(seq::text, 4, '0');
END;
$function$;

-- One-time sync so counters match what is actually on file.
INSERT INTO public.invoice_counter (date_key, last_sequence)
SELECT
  substring(invoice_number from 1 for 6) AS date_key,
  MAX(substring(invoice_number from 7 for 4)::integer) AS last_sequence
FROM public.patient_registrations
WHERE invoice_number ~ '^[0-9]{10}$'
GROUP BY 1
ON CONFLICT (date_key) DO UPDATE
SET last_sequence = EXCLUDED.last_sequence;
