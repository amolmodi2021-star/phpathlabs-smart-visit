

# Update NON PHPL Deduplication: Keep Records with Different Names

## Problem
Currently, the dedup function partitions only by `mobile_number`, so if two NON PHPL records share a mobile but have different patient names (e.g., "AMOL MODI" and "PRIYA MODI" on 9552000200), one gets deleted. The user wants to keep both — only deduplicate when names match (or are blank).

## Solution
Change the `PARTITION BY` in `cleanup_non_phpl_mobile_duplicates()` from `mobile_number` alone to `mobile_number, COALESCE(NULLIF(TRIM(patient_name), ''), '')`. This way:

- Same mobile + same name (or both blank) → deduplicated (keep most recent)
- Same mobile + different names → both kept

### Updated SQL Function

```sql
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
```

### Key change
- **Before**: `PARTITION BY mobile_number` — all records with same mobile compete, one survives
- **After**: `PARTITION BY mobile_number, norm_name` — only records with same mobile AND same name (or both blank) compete

### Files to modify

| File | Change |
|------|--------|
| New migration | Replace `cleanup_non_phpl_mobile_duplicates` function |

No client-side changes needed — the function name and return type stay the same.

