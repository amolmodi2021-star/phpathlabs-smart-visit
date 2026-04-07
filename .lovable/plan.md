

# Deduplicate NON PHPL Records by Mobile Number

## Problem
When NON PHPL records are uploaded, duplicate mobile numbers can accumulate. For example, a record with name "AMOL MODI" and mobile 9552000200 exists, and later 9552000200 is uploaded again without a name — both records persist. The user wants automatic deduplication: keep the record with a name, delete the rest.

## Solution
Create a new database function `cleanup_non_phpl_mobile_duplicates()` that runs after every NON PHPL upload/create, and call it alongside the existing `cleanup_non_phpl_duplicates()`.

### Database function logic

For each mobile number that has **more than one** record where `location = 'NON PHPL'`:
1. If any record has a non-empty `patient_name` → keep the one with the most recent `updated_at` among named records, delete all other NON PHPL records for that mobile
2. If none have a name → keep the one with the most recent `updated_at`, delete the rest

### SQL Function

```sql
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
```

### Client-side integration

Add the call right after the existing `cleanup_non_phpl_duplicates` call in two places:

| File | Location |
|------|----------|
| `CRMContacts.tsx` | After NON PHPL upload (line ~550) |
| `CRMImportReview.tsx` | After approve & transfer (line ~172) |

```typescript
// After existing cleanup call:
const { data: dedupCount } = await supabase.rpc("cleanup_non_phpl_mobile_duplicates" as any);
if (dedupCount && Number(dedupCount) > 0) {
  toast.info(`${dedupCount} NON PHPL duplicate mobile(s) cleaned up`);
}
```

## Files to modify

| File | Change |
|------|--------|
| New migration | Create `cleanup_non_phpl_mobile_duplicates` function |
| `src/components/crm/CRMContacts.tsx` | Call new function after NON PHPL upload |
| `src/components/crm/CRMImportReview.tsx` | Call new function after approve & transfer |

