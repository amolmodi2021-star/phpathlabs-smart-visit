
-- Create a function to get paginated distinct patients with test counts
CREATE OR REPLACE FUNCTION public.get_abnormal_patients(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  contact_primary_key text,
  test_count bigint,
  patient_name text,
  mobile_number text,
  umr_number text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    a.contact_primary_key,
    COUNT(*)::bigint AS test_count,
    COALESCE(c.patient_name, split_part(a.contact_primary_key, '|', 1)) AS patient_name,
    COALESCE(c.mobile_number, split_part(a.contact_primary_key, '|', 2)) AS mobile_number,
    COALESCE(c.umr_number, split_part(a.contact_primary_key, '|', 1)) AS umr_number
  FROM crm_abnormal_tests a
  LEFT JOIN crm_contacts c ON c.primary_key = a.contact_primary_key
  WHERE 
    p_search = '' 
    OR a.contact_primary_key ILIKE '%' || p_search || '%'
    OR c.patient_name ILIKE '%' || p_search || '%'
    OR c.mobile_number ILIKE '%' || p_search || '%'
    OR c.umr_number ILIKE '%' || p_search || '%'
  GROUP BY a.contact_primary_key, c.patient_name, c.mobile_number, c.umr_number
  ORDER BY COALESCE(c.patient_name, a.contact_primary_key)
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Create a function to get total patient count for pagination
CREATE OR REPLACE FUNCTION public.get_abnormal_patients_count(
  p_search text DEFAULT ''
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(DISTINCT a.contact_primary_key)::bigint
  FROM crm_abnormal_tests a
  LEFT JOIN crm_contacts c ON c.primary_key = a.contact_primary_key
  WHERE 
    p_search = '' 
    OR a.contact_primary_key ILIKE '%' || p_search || '%'
    OR c.patient_name ILIKE '%' || p_search || '%'
    OR c.mobile_number ILIKE '%' || p_search || '%'
    OR c.umr_number ILIKE '%' || p_search || '%';
$$;
