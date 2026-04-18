

## Goal
Show real "Collection" date/time on the LIMS report header. It should be the **first time any barcode for that visit was printed** (i.e. first sample collection event). Reprints must NEVER overwrite it.

## Why it's missing today
- `LimsReportHeader` reads `report.sample_collection_date` from `approved_reports`.
- Nothing in the LIMS approval flow ever populates this column — it's only used by the legacy "AI extracted reports" path. So it's always `NULL` → header shows "—".
- Meanwhile, the actual first-print timestamp already exists in `sample_tubes.collected_at`, which is set when "Print & Collect" flips a tube from `pending → collected`. The mutation has `.eq("status", "pending")` so reprints (tubes already collected/accepted) **never overwrite** `collected_at`. → it's already a stable "first print" timestamp per tube.

## Source of truth
For a given registration, the visit-level "Sample Collection Date" = `MIN(sample_tubes.collected_at)` across all tubes for that registration. This represents the moment the *first* barcode was printed and the tube was marked collected. Reprints don't move it.

## Fix plan

### 1. Populate `approved_reports.sample_collection_date` at approval time
In `src/components/lims/DoctorApproval.tsx`, in both upsert sites (single-test approval ~line 393 and approve-all ~line 469, plus the snip-only path ~line 636):

- Before the upsert, fetch `MIN(collected_at)` from `sample_tubes` for `reg.id`:
  ```ts
  const { data: tubes } = await supabase
    .from("sample_tubes")
    .select("collected_at")
    .eq("registration_id", reg.id)
    .not("collected_at", "is", null);
  const firstCollectedAt = tubes?.length
    ? tubes.map(t => t.collected_at).sort()[0]
    : null;
  ```
- Add `sample_collection_date: firstCollectedAt` to the upsert payload.

This ensures every newly approved (or re-approved) test snapshot carries the correct first-print timestamp. Subsequent re-approvals re-compute it from the same source — still safe because reprints never alter `collected_at`.

### 2. Render-time fallback for legacy records (already-approved before this fix)
In `src/pages/LimsReportView.tsx → loadAllData`:

- After fetching `reports` and `regData`, if `report.sample_collection_date` is null/empty for any row, fetch the same `MIN(collected_at)` once and patch it onto each report object before render.
- Cheap: one extra small query per report view, only when missing.

This fixes historical approved reports without requiring a data migration.

### 3. Header formatting (no code change needed)
`LimsReportHeader.formatDate` already formats as `dd-MMM-yyyy hh:mm a` — matches the requested style ("18-Apr-2026 10:24 AM"). Just feeding it a non-null value will make the field appear.

## Files to edit
- `src/components/lims/DoctorApproval.tsx` — 3 upsert sites get `sample_collection_date` from `MIN(sample_tubes.collected_at)`.
- `src/pages/LimsReportView.tsx` — render-time fallback in `loadAllData` when the column is null on existing approved records.

## Out of scope
- No schema change (column already exists).
- No change to `printBarcodes`, `collectMutation`, or sample tube lifecycle — they already give us a reprint-safe "first print" timestamp via `collected_at`.
- No change to PDF capture / signature / pagination logic.
- No change to legacy "extracted reports" header.

## Expected outcome
- New approvals: header shows the exact moment the first barcode was printed, e.g. "Collection: 18-Apr-2026 10:36 AM".
- Existing approved reports: same value appears via the fallback, no data migration needed.
- Reprinting a barcode never changes the displayed Collection date.
- If absolutely no tube was ever collected (edge case), the field still shows "—" gracefully.

