
CREATE OR REPLACE FUNCTION public.cleanup_non_phpl_mobile_duplicates()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  WITH 
  -- Step 1: Delete nameless records when a named record exists for same mobile
  mobiles_with_names AS (
    SELECT DISTINCT mobile_number
    FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IS NOT NULL AND mobile_number != ''
      AND patient_name IS NOT NULL AND TRIM(patient_name) != ''
  ),
  deleted_nameless AS (
    DELETE FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IN (SELECT mobile_number FROM mobiles_with_names)
      AND (patient_name IS NULL OR TRIM(patient_name) = '')
    RETURNING 1
  ),
  -- Step 2: Deduplicate records with same mobile + same name (or both blank)
  normalized AS (
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
  deleted_dupes AS (
    DELETE FROM crm_contacts
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING 1
  )
  SELECT ((SELECT COUNT(*) FROM deleted_nameless) + (SELECT COUNT(*) FROM deleted_dupes))::bigint;
$$;
