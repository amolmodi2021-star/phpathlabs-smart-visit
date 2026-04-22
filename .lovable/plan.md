

# Multi-suffix barcode printing for tests with multiple time-point parameters

## The bug

For invoice **2604220001** (HARSHADA MODI), two OGTT tests are registered:

| Test | Parameter suffixes (each represents a separate sample draw) | Expected tubes | Currently created |
|---|---|---|---|
| OGTT (MODIFIED)(FIVE SAMPLE) | `-F`, `-2`, `-3`, `-4`, `-5` | 5 | **1** (suffix `-F` only) |
| OGTT (MODIFIED)(THREESAMPLES) | `-F`, `-2`, `-3` | 3 | **1** (suffix `-2` only) |

Total expected barcodes: **8**. System currently generates: **2**.

The root cause is in `src/lib/sampleTubeGrouping.ts` lines 108–112:

```ts
const suffixMap: Record<string, string> = {};
(suffixRowsRes.data || []).forEach((tp: any) => {
  const suffix = tp.report_test_parameters?.custom_sample_suffix;
  if (tp.test_id && suffix) suffixMap[tp.test_id] = suffix; // overwrites!
});
```

Each test stores only ONE suffix, then line 130 reads `suffixMap[id]` to build a single tube. When a test has multiple suffix-enabled parameters (different time-point draws like fasting / 1hr / 2hr), the engine collapses them into one tube and one barcode — clinically wrong.

## Fix — collect all suffixes per test, fan out into one tube per suffix

Change the suffix map from `test_id → string` to `test_id → string[]`, then in the grouping loop fan each test out into one tube per suffix (or one tube with no suffix if none defined). The tube-grouping key already includes suffix, so all the downstream logic (recalc, dedup, reconcile, barcode print) already works correctly the moment multiple suffix tubes are produced.

### Changes — `src/lib/sampleTubeGrouping.ts` only

1. Replace the suffix map shape:
   ```ts
   const suffixMap: Record<string, string[]> = {};
   (suffixRowsRes.data || []).forEach((tp: any) => {
     const suffix = tp.report_test_parameters?.custom_sample_suffix?.trim();
     if (!tp.test_id || !suffix) return;
     if (!suffixMap[tp.test_id]) suffixMap[tp.test_id] = [];
     if (!suffixMap[tp.test_id].includes(suffix)) suffixMap[tp.test_id].push(suffix);
   });
   ```

2. In the per-test grouping loop (lines 128–154), iterate over **every (tube × suffix) combination** for that test:
   ```ts
   const suffixes = suffixMap[id]?.length ? suffixMap[id] : [""];
   for (const t of tubes) {
     for (const sfx of suffixes) {
       const key = `${t.tube}||${sfx}`;
       // ... existing group creation logic, using `sfx` instead of `suffix`
     }
   }
   ```

3. Preserve display-order: select suffixes in `report_test_parameters` query in the same order they appear via `test_parameters.display_order` so barcodes print as `-F`, `-2`, `-3`, `-4`, `-5` (not random). Add an `.order("display_order")` on the `test_parameters` join.

That's the entire fix — ~15 lines in one file.

## Why the rest works automatically

- **Sample tube creation** (`PatientRegistration.tsx`, `recalcTubesForRegistration` in `SampleCollection.tsx`) calls `buildSampleTubeGroups` and inserts whatever it returns. Returning 5+3 groups instead of 1+1 means 8 rows in `sample_tubes`.
- **Signature/dedup** in `recalcTubesForRegistration` (line 207) keys on `tube_type||suffix||testIds`, so multi-suffix tubes are correctly distinct and won't be deleted/recreated on every reconcile.
- **Barcode printing** (`barcodePrint.ts` lines 70–71) already concatenates `${invoice_number}${suffix}` per tube, so each of the 8 tubes prints `2604220001-F`, `2604220001-2`, etc.
- **Sample acceptance / order push** (`SampleAcceptance.tsx` line 241) already builds `sampleId` per tube using the suffix, so each timepoint becomes a distinct LIMS order ID for the analyzer.
- **Test-level dedup across tests sharing suffix-disabled tubes** is unaffected (CBC and a profile's CBC still share one EDTA tube).

## What stays untouched

- All UI in Sample Collection / Sample Acceptance.
- Tube-color, sample-type, multi-tube-per-test logic, tube-cancellation logic.
- Existing registrations: when the user opens this registration, `recalcTubesForRegistration` will detect the new desired signatures don't match and rebuild only the **pending** tubes. Already-collected tubes are preserved — but in this user's case both tubes are still pending, so they'll be replaced with the correct 5+3 set.
- Database schema. No migration.

## Verification

1. Open `/lims?tab=sample_collection`, find invoice 2604220001.
2. The pending tubes count should auto-recalculate to **8** (5 for FIVE SAMPLE + 3 for THREESAMPLES) after the fix deploys and the row is touched.
3. Select all → Print & Collect → barcode PDF shows 8 stickers: `2604220001-F`, `…-2`, `…-3`, `…-4`, `…-5`, `…-F`, `…-2`, `…-3`.
4. Test a non-OGTT registration (e.g., a single CBC) — should still produce exactly 1 tube with no suffix.
5. Test a profile that contains a suffix-enabled test — suffix tubes still emerge correctly.

## Risk

Low. The change is local to one helper. The data flow (`buildSampleTubeGroups → insert sample_tubes → printBarcodes`) is already designed around the (tubeType, suffix) tuple. We're just teaching the helper to emit the full set instead of one collapsed entry.

## Files changing

| File | Change |
|---|---|
| `src/lib/sampleTubeGrouping.ts` | Convert `suffixMap` from string to string[]; fan out one group per (tube × suffix); add display_order on the suffix query |

