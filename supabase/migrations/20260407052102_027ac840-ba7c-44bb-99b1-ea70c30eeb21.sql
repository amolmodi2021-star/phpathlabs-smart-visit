
CREATE OR REPLACE FUNCTION public.cleanup_non_phpl_duplicates()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mobiles_with_bills AS (
    SELECT DISTINCT mobile_number
    FROM crm_contacts
    WHERE bill_number IS NOT NULL 
      AND bill_number != ''
      AND UPPER(TRIM(location)) != 'NON PHPL'
      AND mobile_number IS NOT NULL
      AND mobile_number != ''
  ),
  deleted AS (
    DELETE FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IN (SELECT mobile_number FROM mobiles_with_bills)
    RETURNING 1
  )
  SELECT COUNT(*)::bigint FROM deleted;
$$;
