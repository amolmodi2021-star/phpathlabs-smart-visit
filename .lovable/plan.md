## Goal

When a new patient is registered, allot a UMR number that is **strictly greater than any UMR already in use anywhere in the system** (legacy imports, existing registrations, estimates, patient_master). Allotment must be safe under concurrent registrations from multiple users.

## Background

- Today, `generate_umr_number()` increments a counter row in `umr_counter`. After the legacy Excel import, `patient_master` may contain UMRs like `UMR0123456` while the counter is still at `7` — the next generated UMR would collide or look out of order.
- We need: **next UMR = MAX(existing UMR sequence across the system) + 1**, computed atomically.

## Plan

### 1. Rewrite `generate_umr_number()` (migration)

New implementation, fully serialized via a row-level lock on `umr_counter` so parallel callers can't both grab the same number:

```sql
CREATE OR REPLACE FUNCTION public.generate_umr_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_counter int;
  v_max_pm  int;
  v_max_pr  int;
  v_max_est int;
  v_next    int;
BEGIN
  -- 1. Lock the counter row — serializes concurrent UMR allocation.
  SELECT last_sequence INTO v_counter
  FROM umr_counter
  WHERE counter_key = 'main'
  FOR UPDATE;

  -- 2. Highest UMR currently in use anywhere (handles legacy gaps).
  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_id,        '\D','','g'),'')::int),0) INTO v_max_pm  FROM patient_master       WHERE umr_id        ~ '^UMR\d+$';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_number,    '\D','','g'),'')::int),0) INTO v_max_pr  FROM patient_registrations WHERE umr_number    ~ '^UMR\d+$';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_number,    '\D','','g'),'')::int),0) INTO v_max_est FROM estimates             WHERE umr_number    ~ '^UMR\d+$';

  v_next := GREATEST(v_counter, v_max_pm, v_max_pr, v_max_est) + 1;

  UPDATE umr_counter SET last_sequence = v_next WHERE counter_key = 'main';

  RETURN 'UMR' || lpad(v_next::text, 7, '0');
END;
$$;
```

Why this is safe:
- `SELECT … FOR UPDATE` on the single `umr_counter` row blocks every other call to `generate_umr_number()` until this transaction commits. Two simultaneous registrations cannot get the same number.
- `MAX(...)` across the three tables guarantees we always step past whatever exists today (including freshly-imported legacy UMRs and any historical visit), so the user's "largest sequence number" rule is enforced.
- The counter row gets bumped to the new value, so subsequent calls don't have to re-scan unless even-larger UMRs show up later (e.g. another legacy import).

> Note: this does **not** fill gaps in the middle of the sequence. The user's instruction is to *avoid* gaps becoming a problem by always using `MAX+1`, not to recycle skipped numbers (recycling is unsafe — a gap may belong to a deleted-but-archived patient).

### 2. Re-bump the counter once (one-shot, after migration)

In the same migration, jump `umr_counter.last_sequence` to the current MAX so the very first `generate_umr_number()` call after legacy import is fast:

```sql
UPDATE umr_counter
SET last_sequence = GREATEST(
  last_sequence,
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_id,     '\D','','g'),'')::int) FROM patient_master       WHERE umr_id     ~ '^UMR\d+$'), 0),
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int) FROM patient_registrations WHERE umr_number ~ '^UMR\d+$'), 0),
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int) FROM estimates             WHERE umr_number ~ '^UMR\d+$'), 0)
)
WHERE counter_key = 'main';
```

### 3. Allocation timing in the app (no code change needed, but verified)

- `PatientRegistration.tsx` already calls `supabase.rpc("generate_umr_number")` **only at save time**, immediately before inserting the registration row. No UMR is reserved while the form is open. ✓
- `CompletedHomeVisits.tsx` uses the same RPC at save time. ✓
- The legacy import does not call the RPC — it inserts the legacy UMRs verbatim. ✓
- Patient Master upsert uses the freshly-allocated `finalUmr`. ✓

No frontend code changes are required; the new SQL function is a drop-in replacement.

## Files touched

- `supabase/migrations/<ts>_umr_max_plus_one.sql` — rewrite `generate_umr_number()` and rebump counter.

## Out of scope

- Recycling deleted/skipped UMRs (intentionally not done — keeps audit trail clean).
- Changing the `UMR` prefix or zero-padding width.
