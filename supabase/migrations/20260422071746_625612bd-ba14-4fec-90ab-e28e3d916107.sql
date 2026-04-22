-- Slim RPC: returns deduplicated contact_primary_keys from crm_abnormal_tests
CREATE OR REPLACE FUNCTION public.get_abnormal_pks()
RETURNS TABLE (contact_primary_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT contact_primary_key
  FROM public.crm_abnormal_tests
  WHERE contact_primary_key IS NOT NULL;
$$;

-- Slim RPC: returns only the columns drip needs, only contacts with a mobile number
CREATE OR REPLACE FUNCTION public.get_drip_contact_slice()
RETURNS TABLE (
  primary_key text,
  mobile_number text,
  umr_number text,
  patient_name text,
  last_sent_type text,
  last_sent_date timestamptz,
  location text,
  visit_date text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    primary_key,
    mobile_number,
    umr_number,
    patient_name,
    last_sent_type,
    last_sent_date,
    location,
    visit_date
  FROM public.crm_contacts
  WHERE mobile_number IS NOT NULL
    AND length(trim(mobile_number)) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_abnormal_pks() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_drip_contact_slice() TO anon, authenticated;