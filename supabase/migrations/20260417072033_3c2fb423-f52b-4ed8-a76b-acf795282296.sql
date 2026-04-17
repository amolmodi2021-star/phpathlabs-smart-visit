CREATE OR REPLACE FUNCTION public.generate_invoice_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMMDD');
  seq integer;
BEGIN
  INSERT INTO invoice_counter (date_key, last_sequence)
  VALUES (today, 1)
  ON CONFLICT (date_key) DO UPDATE SET last_sequence = invoice_counter.last_sequence + 1
  RETURNING last_sequence INTO seq;
  RETURN today || lpad(seq::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_sample_uid()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMMDD');
  seq integer;
BEGIN
  INSERT INTO sample_tube_counter (date_key, last_sequence)
  VALUES (today, 1)
  ON CONFLICT (date_key) DO UPDATE SET last_sequence = sample_tube_counter.last_sequence + 1
  RETURNING last_sequence INTO seq;
  RETURN 'S' || today || lpad(seq::text, 5, '0');
END;
$function$;