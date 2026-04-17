

## Root cause
Already-mapped codes (PDW, RBC, WBC, HGB, MCV, MCH, MCHC, PLT) appear in **Unmapped Results** because their `lims_unmapped_results` rows were inserted (05:11–05:19 UTC on 16-Apr) **before** the mappings were created in `lims_code_mapping` (06:18–06:56 UTC).

The edge function correctly classified them as unmapped at submission time. The per-row **"Map"** button (`resolveUnmapped`) auto-resolves all sibling unmapped rows with the same `machine_code` — but the **"Add Mapping Manually"** form (`addMapping`) does NOT do this back-fill. So mappings created via the manual form (or any path other than the resolve button) leave historical unmapped rows orphaned.

Verified data:
- 8 mappings exist (PDW, RBC, WBC, HGB, MCV, MCH, MCHC, PLT) — all created 06:18–06:56 UTC.
- ~30+ unresolved unmapped rows exist for those same codes — all received 05:11–05:19 UTC.

## Fix (2 parts)

### A. One-time backfill (migration)
Soft-resolve every existing `lims_unmapped_results` row whose `machine_code` already has any entry in `lims_code_mapping`. This clears the current stale rows for PDW, RBC, WBC, HGB, MCV, MCH, MCHC, PLT, and any other historical drift.

```sql
UPDATE public.lims_unmapped_results u
SET is_resolved = true
WHERE u.is_resolved = false
  AND EXISTS (
    SELECT 1 FROM public.lims_code_mapping m
    WHERE m.machine_code = u.machine_code
  );
```

Note: this only flips `is_resolved`; it does NOT retroactively insert into `lims_test_results` for those old samples (consistent with how the dispatch-removed orders behave — historical rows aren't resurrected).

### B. Prevent recurrence — patch `addMapping` (`src/pages/LimsDemo.tsx`)
After inserting a new mapping in `addMapping.mutationFn`, also auto-resolve any existing unmapped rows with the matching `machine_code`:

```ts
// after the successful insert into lims_code_mapping
await supabase.from("lims_unmapped_results")
  .update({ is_resolved: true })
  .eq("machine_code", machineCode)
  .eq("is_resolved", false);
```

Same one-line back-fill should be added to `updateMapping` as a safety net (in case a row was added via direct DB / future flow).

Toast updated to: "Mapping added — historical unmapped rows for this code cleared".

## Out of scope
- Edge function logic — already correct.
- `resolveUnmapped` — already does this.
- No retroactive insert into `lims_test_results` for historical samples (matches existing behaviour).

## Files
- New migration — one-time `UPDATE` to soft-resolve stale rows.
- `src/pages/LimsDemo.tsx` — add back-fill step inside `addMapping` (and `updateMapping`) mutations (~3 lines each).

