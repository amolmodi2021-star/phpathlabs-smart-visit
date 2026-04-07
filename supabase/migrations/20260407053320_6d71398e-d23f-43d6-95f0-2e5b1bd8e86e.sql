
CREATE OR REPLACE FUNCTION public.cleanup_non_phpl_mobile_duplicates()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ranked AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY mobile_number
        ORDER BY
          CASE WHEN patient_name IS NOT NULL AND TRIM(patient_name) != '' THEN 0 ELSE 1 END,
          updated_at DESC
      ) AS rn
    FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IS NOT NULL AND mobile_number != ''
      AND mobile_number IN (
        SELECT mobile_number FROM crm_contacts
        WHERE UPPER(TRIM(location)) = 'NON PHPL'
          AND mobile_number IS NOT NULL AND mobile_number != ''
        GROUP BY mobile_number HAVING COUNT(*) > 1
      )
  ),
  deleted AS (
    DELETE FROM crm_contacts
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING 1
  )
  SELECT COUNT(*)::bigint FROM deleted;
$$;
