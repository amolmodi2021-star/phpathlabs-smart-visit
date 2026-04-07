CREATE OR REPLACE FUNCTION public.cleanup_non_phpl_mobile_duplicates()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH normalized AS (
    SELECT id, mobile_number,
      COALESCE(NULLIF(TRIM(patient_name), ''), '') AS norm_name,
      updated_at
    FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IS NOT NULL AND mobile_number != ''
  ),
  dupes AS (
    SELECT mobile_number, norm_name
    FROM normalized
    GROUP BY mobile_number, norm_name
    HAVING COUNT(*) > 1
  ),
  ranked AS (
    SELECT n.id,
      ROW_NUMBER() OVER (
        PARTITION BY n.mobile_number, n.norm_name
        ORDER BY
          CASE WHEN n.norm_name != '' THEN 0 ELSE 1 END,
          n.updated_at DESC
      ) AS rn
    FROM normalized n
    INNER JOIN dupes d ON n.mobile_number = d.mobile_number AND n.norm_name = d.norm_name
  ),
  deleted AS (
    DELETE FROM crm_contacts
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING 1
  )
  SELECT COUNT(*)::bigint FROM deleted;
$$;