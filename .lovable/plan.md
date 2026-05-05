## Per-Pickup-Point Report Footer Note

Add a configurable paragraph on each pickup point that, when the patient is registered under that pickup point, prints below the tests on every page of the report PDF — without spilling onto the next page.

### 1. Database
Migration:
- `ALTER TABLE pickup_points ADD COLUMN report_footer_note text;`

### 2. Settings UI — `src/components/lims/PickupPointManager.tsx`
- Add `reportFooterNote` state, wire `resetForm`, `openEdit`, and the save payload (`report_footer_note: reportFooterNote || null`).
- In the add/edit form, add a `Textarea` labeled "Report Footer Note (printed on every page of the report PDF)" with helper text "Keep it short — long text reduces space available for test results on each page."

### 3. Report rendering — `src/pages/LimsReportView.tsx`
- In `loadAllData`, when `regData.pickup_point_id` exists, fetch `report_footer_note` from `pickup_points` and store in state `pickupFooterNote`.
- Render the note inside the per-page content layer, **between the test content and the signature block** (i.e. just before the `mt-auto` signature `<div>`), as:
  ```
  <div style={{ fontSize: "10px", lineHeight: 1.35, padding: "2mm 0",
                borderTop: "1px solid #e5e5e5", whiteSpace: "pre-wrap" }}>
    {pickupFooterNote}
  </div>
  ```
  Only rendered when `pickupFooterNote` is non-empty. Appears on every page automatically because it's inside the per-page template.

### 4. Pagination height accounting (the "no spill-over" requirement)
The current pagination in `useMemo` computes `usableHeight` as:
```
PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM
```
Add a `FOOTER_NOTE_HEIGHT_MM` term that is computed from the note text length so the per-page test area shrinks accordingly:

```ts
const footerNoteMm = pickupFooterNote
  ? 4 /* top border + padding */ +
    Math.max(1, Math.ceil(pickupFooterNote.length / 110),
                  pickupFooterNote.split(/\r?\n/).length) * 4
  : 0;
const usableHeight = PAGE_HEIGHT_MM - topMm - bottomMm
  - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM
  - footerNoteMm;
```
Add `pickupFooterNote` to the `useMemo` dependency array so re-pagination occurs when it loads.

Apply the same `- footerNoteMm` reduction to the snip-page `maxHeight` calculation (line ~1140) and the `AutoScaleContent` `availableHeight` (line ~1124) so fit-to-page tests and outsourced snip pages also leave room for the footer note.

### 5. Scope
- The note appears on **all pages** of the report (structured + snip pages) for any registration whose `pickup_point_id` has a non-empty `report_footer_note`.
- For walk-in / channel / home-visit registrations (no pickup point), behaviour is unchanged.
- Provisional report preview also picks it up since it uses the same `regData.pickup_point_id`.

### Files touched
- new migration adding `pickup_points.report_footer_note`
- `src/components/lims/PickupPointManager.tsx`
- `src/pages/LimsReportView.tsx`
