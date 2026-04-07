

# Auto-Delete NON PHPL Records When Patient Gets a Bill Number

## Problem
When a patient initially registered as "NON PHPL" (prospect) later visits PH VESU and gets a bill number, the old NON PHPL records with the same mobile number remain in the CRM. This creates duplicate entries — the patient should only exist under their PH VESU record.

## Solution
Add a cleanup step in **every place** where records are inserted/upserted into `crm_contacts` — after the upsert completes, delete all NON PHPL records where the same mobile number now has at least one record with a bill number (i.e., a PH VESU record exists).

### Implementation approach: Database function

Create a reusable SQL function `cleanup_non_phpl_duplicates()` that:
1. Finds all mobile numbers that have **both** a record with a non-empty `bill_number` (PH VESU patient) **and** a record with `location = 'NON PHPL'`
2. Deletes all `NON PHPL` records for those mobile numbers
3. Returns the count of deleted records

This function will be called from the client after every data modification that could introduce bill numbers.

### Places to add the cleanup call

| Location | File | When |
|----------|------|------|
| Import → Approve & Transfer | `CRMImportReview.tsx` | After upsert completes |
| NON PHPL Upload | `CRMContacts.tsx` | After upsert completes |
| Daily Import Staging | `CRMImport.tsx` | No change needed (staging only) |
| Contact Edit Dialog | `CRMContacts.tsx` | After individual record save (if bill_number changed) |

### Database function SQL

```sql
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
  ),
  deleted AS (
    DELETE FROM crm_contacts
    WHERE UPPER(TRIM(location)) = 'NON PHPL'
      AND mobile_number IN (SELECT mobile_number FROM mobiles_with_bills)
    RETURNING 1
  )
  SELECT COUNT(*)::bigint FROM deleted;
$$;
```

### Client-side usage (after each upsert)

```typescript
const { data: deletedCount } = await supabase.rpc("cleanup_non_phpl_duplicates");
if (deletedCount && deletedCount > 0) {
  toast.info(`${deletedCount} NON PHPL duplicate(s) auto-removed`);
}
```

## Files to modify

| File | Change |
|------|--------|
| New migration | Create `cleanup_non_phpl_duplicates` function |
| `src/components/crm/CRMImportReview.tsx` | Call cleanup after approve & transfer |
| `src/components/crm/CRMContacts.tsx` | Call cleanup after NON PHPL upload and after individual contact edits |

