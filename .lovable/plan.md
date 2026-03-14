

## Problem

The current deduplication logic uses `profile_name` as part of the key (`parameter_name::profile_name`), which causes parameters to be incorrectly deleted when profiles get reassigned during enrichment. The content fingerprint pass also collapses rows that shouldn't be collapsed.

## New Deduplication Logic (User's Final Rule)

**Key = `parameter_name + test_name` (AI-extracted test_name)**
- If duplicates exist on this key, keep the **latest** (last occurrence wins).
- If after dedup, two rows still share the same `parameter_name` but different `test_name`, keep both — they are legitimately different tests.
- After dedup, update each row's `test_name` to the **DB master test_name** (from `report_test_parameters`) so that parameter grouping in reports uses the master test_name rather than the AI-extracted one.

## Files to Change

### 1. `src/pages/ReviewReport.tsx`
- **Replace `dedupeTestResults`** (lines ~387-426): New function uses `normalizeResultKey(parameter_name) + "::" + normalizeResultKey(test_name)` as key. Latest row wins, no content fingerprint pass.
- **Remove** `getCanonicalResultScope`, `getContentFingerprint`, `normalizeComparable` (lines ~381-409) — no longer needed.
- **Update `enrichResults`** (lines ~208-291): After profile/department enrichment, also set `r.test_name` to the matched master `test_name` from `report_test_parameters` when a match is found. This ensures grouping headers in the report use DB test names.

### 2. `src/pages/ViewReport.tsx`
- **Replace `dedupeResultsLatest`** (lines ~199-210): Same new logic — key = `parameter_name + test_name`, latest wins, no content fingerprint.
- **Remove** `getCanonicalResultScope`, `getResultDedupeKey`, `normalizeComparableValue`, `getResultContentFingerprint` — replaced by the simpler key function.
- **Add test_name enrichment** from master data during the backfill pass (already partially exists around line 280+).

### 3. `supabase/functions/process-report-queue/index.ts`
- **Replace dedupe block** (lines ~351-372): Same new logic — key = `normalizeKey(parameter_name) + "::" + normalizeKey(test_name)`, latest wins.
- **Remove** `getScope` function — no longer needed.
- Keep the merge logic for duplicate `reg_no` reports as-is (that's a different concern).

## Summary of Changes

| Location | Old Key | New Key |
|----------|---------|---------|
| ReviewReport | `param::profile\|test\|param` + content fingerprint | `param::test_name` only |
| ViewReport | `param::profile\|test\|param` + content fingerprint | `param::test_name` only |
| process-report-queue | `param::profile\|test\|param` | `param::test_name` only |

The enrichment step will also map AI `test_name` → DB master `test_name` so that report grouping headers reflect the master data naming.

