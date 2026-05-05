# Provisional Report Preview in Result Verification

Add a "View Report" capability on the Result Verification screen that renders the report exactly the way Dispatch does (same pagination, dept-wise grouping, fit-to-page auto-scaling, profile/test grouping, snips, etc.) but in a **provisional** mode used to verify pre-approval layout.

## Behaviour

- Triggered per patient from Result Verification, using the existing **selected patient/test** UI (same dialog pattern as Dispatch's "Select Tests for Report").
- Opens the existing `LimsReportView` route in a new mode: `/lims/report/:regId?provisional=1&tests=<csv>`.
- In provisional mode:
  - **No letterhead** (toggle hidden, forced off).
  - **No signature block** (signature row + page footer signatures suppressed; page numbers stay).
  - **Diagonal "PROVISIONAL REPORT" watermark** rendered behind every page — very light grey, 45° rotation, large bold sans-serif, repeated/centered, `pointer-events:none`, behind content but above background.
  - **Header / patient demographics**: identical to current report.
  - **Results**: identical rendering — `ReportResultsSection`, `AutoScaleContent`, dept ordering, profile grouping, snips, abnormal flags — using the same components.
  - **Download PDF / Print** buttons remain available (they capture the same provisional layout including watermark) so users can save a copy for review. Share-to-WhatsApp stays hidden (it's already gated behind `isPublic`).

## Data source

`approved_reports` only exists post-approval. For provisional, build the same `test_results` JSONB shape on the fly from live tables:

1. Read `patient_registrations` row.
2. Read `patient_results` for the registration where `status IN ('entered','pending','verified','approved','dispatched')` — i.e. anything with a current value (verified preferred; un-verified still shown so the user can see exactly what will go out).
3. Filter by `tests` query param if present.
4. Join with `test_parameters` + `report_test_parameters` (descriptions, subheaders) and `tests` master (already loaded via `testsMap`) to reconstruct each `TestResultEntry { test_id, parameter_id, result_value, reference_range, flag, unit, ... }` exactly like an approved snapshot.
5. Pull `outsourced_test_snips` exactly as today.
6. Sample collection date: same fallback already used (MIN of `sample_tubes.collected_at`).
7. Approval date / approver fields: leave empty (signature block is suppressed anyway).

Wrap it in the same `[{ test_results, outsourced_snip_urls, patient_*, ... }]` array shape so the rest of `LimsReportView` (pagination, grouping, AutoScaleContent) needs no changes.

## File-level changes

1. **`src/pages/LimsReportView.tsx`**
   - Read `provisional = searchParams.get("provisional") === "1"`.
   - When `provisional`, branch in `loadAllData()`:
     - Skip `approved_reports` fetch; instead query `patient_results` + `test_parameters` and assemble `filteredReports` in the existing shape.
     - Skip signature loading & inlining (not needed).
   - Force `showLetterhead = false` and hide the letterhead toggle when provisional.
   - Hide print/share toggles? Keep Print + Download (still useful for review).
   - Inside each page render, when provisional:
     - Skip `<LimsReportHeader>`? **No** — keep it (user explicitly wants demographics).
     - Skip the entire signature `<div className="mt-auto">…</div>` block (render only the Page Number).
     - Add a watermark layer inside the `data-page` container (sibling of letterhead, above background but below content):
       ```tsx
       <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 0 }}>
         <span style={{ transform: "rotate(-35deg)", fontSize: "90px", fontWeight: 800, color: "rgba(180,180,180,0.18)", letterSpacing: "6px", whiteSpace: "nowrap" }}>
           PROVISIONAL REPORT
         </span>
       </div>
       ```
     - Title bar text becomes `"Provisional Report — {name} ({invoice})"`.
   - Back button returns to `/lims?tab=verification` instead of dispatch when provisional.

2. **`src/components/lims/ResultVerification.tsx`**
   - Add an `Eye` "View Report" button per patient row (next to existing Verify All / actions area).
   - On click, open a "Select Tests for Report" dialog identical to Dispatch's (filter to tests with `status IN ('entered','pending','verified')`; default all selected).
   - "Generate Report" button → `navigate(\`/lims/report/${regId}?provisional=1&tests=${ids.join(",")}\`)`.

3. **No DB changes**, no edge-function changes, no new dependencies.

## Technical notes

- The watermark is an absolute layer inside the `data-page` element, so the existing `html-to-image` PDF capture (with `pixelRatio: 3` retry logic) will include it automatically — no extra wiring.
- `AutoScaleContent`, dept ordering, profile grouping, snip pages, and pagination engine all stay untouched — provisional just feeds them a synthetic `test_results` array.
- Bypassing signatures means we can also skip the `pathologist_signatures` / `urlToDataUrl` work in provisional mode → faster load.
- Existing differential-count-validation, time-format, abnormal-flag rules are all rendering-side and continue to apply.

## Out of scope

- No memory file required (feature reuses existing report architecture rules).
- No change to approved-report flow, no change to Dispatch.
