DROP FUNCTION IF EXISTS public.get_drip_contact_slice();

CREATE FUNCTION public.get_drip_contact_slice()
RETURNS TABLE (
  id uuid,
  primary_key text,
  mobile_number text,
  umr_number text,
  patient_name text,
  last_sent_type text,
  last_sent_date timestamptz,
  location text,
  visit_date text,
  record_tag text,
  default_discount_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    primary_key,
    mobile_number,
    umr_number,
    patient_name,
    last_sent_type,
    last_sent_date,
    location,
    visit_date,
    record_tag,
    default_discount_pct
  FROM public.crm_contacts
  WHERE mobile_number IS NOT NULL
    AND length(trim(mobile_number)) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_drip_contact_slice() TO anon, authenticated;