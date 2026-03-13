

## Problem

The merge key on line 429-430 uses `parameter_name::profile_name` as the composite key. However, `profile_name` is often empty or not yet assigned during extraction — it gets assigned later in the review/generation phase. This means:

1. **Same-name parameters across different tests collide** — e.g., "Proteins" in LFT and "Proteins" in Urine Routine Analysis both produce key `proteins::` and one overwrites the other.
2. **When re-uploading the same PDF**, since keys collide incorrectly, the Map ends up with wrong merges, resulting in duplicates appearing in the review screen.

The extracted data *does* have a `test_name` field (set by the AI during extraction) which distinguishes these parameters. The existing `dedupeByConfidence` function already uses `test_name` in its key — but the merge logic doesn't.

## Fix

### 1. `src/pages/UploadReport.tsx` — Update `getMergeKey` to include `test_name`

Change the merge composite key from:
```
parameter_name :: profile_name
```
to:
```
parameter_name :: test_name :: profile_name
```

This ensures "Proteins" under "LIVER FUNCTION TEST" and "Proteins" under "URINE ROUTINE ANALYSIS" get separate keys and don't collide, while true duplicates (same parameter + same test) are properly merged.

### 2. Same file — Also apply deduplication to the *new extraction itself*

Currently, when uploading the exact same PDF, the extraction produces the same parameters twice (once from old data, once from new). The `dedupeByConfidence` runs on extracted results but the merge logic adds *all* existing results first, then overlays new ones. If no existing report is found (or the keys don't match), duplicates slip through.

Add a final deduplication pass on `finalTestResultsToSave` using the same composite key before saving, keeping the entry with the latest `_merge_status` priority (new > updated > existing).

### Files Modified
- `src/pages/UploadReport.tsx` — fix `getMergeKey` function and add final dedup pass

