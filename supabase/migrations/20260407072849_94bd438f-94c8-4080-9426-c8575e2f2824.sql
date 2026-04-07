
-- Drop both overloaded versions
DROP FUNCTION IF EXISTS public.get_crm_contacts_paginated(integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.get_crm_contacts_paginated(text, text, text, integer, integer);

-- Recreate single version with SECURITY DEFINER and numeric bill sort
CREATE OR REPLACE FUNCTION public.get_crm_contacts_paginated(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT '',
  p_location text DEFAULT 'ALL',
  p_tag text DEFAULT 'ALL'
)
RETURNS TABLE(
  id uuid, primary_key text, patient_name text, mobile_number text, umr_number text,
  location text, visit_date text, visit_type text, bill_number text, doctor_name text,
  gross_amount numeric, discount_amount numeric, net_amount numeric, paid_amount numeric, due_amount numeric,
  payment_type text, remarks text, created_by text, record_tag text, default_discount_pct numeric,
  last_sent_type text, last_sent_date timestamptz, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id, c.primary_key, c.patient_name, c.mobile_number, c.umr_number,
    c.location, c.visit_date, c.visit_type, c.bill_number, c.doctor_name,
    c.gross_amount, c.discount_amount, c.net_amount, c.paid_amount, c.due_amount,
    c.payment_type, c.remarks, c.created_by, c.record_tag, c.default_discount_pct,
    c.last_sent_type, c.last_sent_date, c.created_at, c.updated_at
  FROM crm_contacts c
  WHERE
    (p_location = 'ALL' OR c.location = p_location)
    AND (p_tag = 'ALL' OR c.record_tag = p_tag)
    AND (
      p_search = ''
      OR c.patient_name ILIKE '%' || p_search || '%'
      OR c.mobile_number ILIKE '%' || p_search || '%'
      OR c.umr_number ILIKE '%' || p_search || '%'
    )
  ORDER BY
    CASE WHEN UPPER(TRIM(c.location)) = 'PH VESU' THEN 0 ELSE 1 END,
    CASE
      WHEN UPPER(TRIM(c.location)) = 'PH VESU' AND c.visit_date ~ '^\d{1,2}-\d{1,2}-\d{4}$' THEN
        TO_DATE(c.visit_date, 'DD-MM-YYYY')
      ELSE '1900-01-01'::date
    END DESC,
    CASE
      WHEN UPPER(TRIM(c.location)) = 'PH VESU' AND c.bill_number IS NOT NULL AND c.bill_number != '' THEN
        NULLIF(REGEXP_REPLACE(c.bill_number, '\D', '', 'g'), '')::bigint
      ELSE 0
    END DESC,
    c.created_at DESC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$$;
