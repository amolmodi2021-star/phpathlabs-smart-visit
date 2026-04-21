

# Patient Portal v2 — Multi-Visit Tracking, Department Grouping, Abnormal History, Previous Reports

Enhances `/r/<token>` with department-sorted tests, multi-bill aggregation for the same UMR + same date, partial-approved batch download, an Abnormal History timeline across all visits for that UMR, a Previous Reports section, and a quick Call button.

## What changes for the patient

```text
┌─────────────────────────────────────────────────────────┐
│ PH PathLabs · Patient Portal                            │
├─────────────────────────────────────────────────────────┤
│ RAJESH KUMAR  · UMR 12345 · 22-04-2026                  │
│ Invoice 2604220042 (+ 2604220051 – same day)            │
│ [ Refresh ]                                             │
├─────────────────────────────────────────────────────────┤
│ ▣ HAEMATOLOGY                                           │
│   • Complete Blood Count   ●━●━●━●━○  In progress       │
│   • ESR                    ●━●━●━●━●  ✓ Approved        │
│ ▣ BIOCHEMISTRY                                          │
│   • SGPT                   ●━●━●━●━●  ✓ Approved        │
│   • Lipid Profile          ●━●━○━○━○  Sample processing │
│ ▣ SEROLOGY                                              │
│   • HbA1c                  ●━●━●━●━●  ✓ Approved        │
├─────────────────────────────────────────────────────────┤
│ [ ⬇ Download Approved Reports (3 of 5) ]                │
│ [ ⬇ Download Full Report ] (greys out till all approved)│
├─────────────────────────────────────────────────────────┤
│ 🩺 Abnormal History (UMR 12345)                         │
│   ▸ SGPT  (5 results) ──────── tap to expand            │
│       ▾ 22-04-2026 · 78 U/L · Ref 0–40                  │
│         15-01-2026 · 65 U/L · Ref 0–40                  │
│         …                                               │
│   ▸ HbA1c (3 results)                                   │
├─────────────────────────────────────────────────────────┤
│ 📁 Previous Reports (UMR 12345)                         │
│   • 15-01-2026 · Invoice 2601150028 · 6 tests · ⬇       │
│   • 02-11-2025 · Invoice 2511020014 · 3 tests · ⬇       │
├─────────────────────────────────────────────────────────┤
│ Need help? [ 📞 Call PH PathLabs · 6356 55 66 99 ]      │
└─────────────────────────────────────────────────────────┘
```

## Behaviour rules

1. **Multi-bill aggregation (same UMR + same visit date):**
   - On portal load, fetch all `patient_registrations` rows where `umr_number = current UMR` AND `created_at::date = current registration's date` AND `bill_cancelled = false`.
   - Merge their tests into one tracking view; show all invoice numbers in the header chip ("Invoice A + B").
   - Status data (results/tubes/snips) is queried via `registration_id IN (…)`.
   - Download links for each invoice are generated separately under the hood (PDF generator works per registration_id) but presented as one consolidated "Download Approved Reports" action that loops through registrations.

2. **Department-wise grouping & sorting:**
   - For each leaf test, look up `tests.department_id → report_departments.department_name` (also handle `billing_profiles.department_id` for profile leaves and `combos`).
   - Group tests by department; sort departments alphabetically (or by `report_departments.display_order` if present); within each department sort tests alphabetically.
   - Tests with no department fall under "Other" at the bottom.

3. **Partial-approved batch download (replaces per-test PDF buttons):**
   - Single primary action: **Download Approved Reports (X of Y)** — generates PDF containing all currently-approved tests across all aggregated registrations.
   - Disabled when X = 0; relabels to **Download Full Report** when X = Y.
   - Still blocked by `due_amount > 0` (banner unchanged). Sums dues across aggregated registrations.
   - Logs analytics event `downloaded` with metadata `{ approved_count, total_count, registration_ids }`.

4. **Abnormal History section:**
   - Look up all `crm_contacts.primary_key` whose `umr_number = current UMR`.
   - Fetch `crm_abnormal_tests` for those PKs.
   - Group by `test_name` (case-insensitive trim); each group shown as a collapsible row with a count badge.
   - Inside each, list entries sorted by `test_date` descending (uses existing `sortAbnormalTestsByDateDesc` from `src/lib/abnormalTests.ts`); columns: Date · Result · Reference range.
   - Includes the current visit's abnormal results too (already in `crm_abnormal_tests` post-approval) — no special merge needed.
   - Section hidden if zero abnormal records.

5. **Previous Reports section:**
   - Query `approved_reports` where `umr_number = current UMR` AND `registration_id NOT IN (current aggregated set)`, ordered by `approval_date` (or `registration_date`) desc.
   - For each row show: Visit date (dd-MM-yyyy) · Invoice · Test count · `Download` button.
   - Download button opens `/lims/report/<registration_id>?public=<token>` (existing public route guard).
   - Cap at most recent 20; "Show more" if more exist.
   - Section hidden if no prior approved reports for this UMR.

6. **Call button (sticky bottom):**
   - Sticky footer card with `<a href="tel:+916356556699">📞 Call PH PathLabs · 6356 55 66 99</a>` styled as a primary button. Number sourced from existing `app_settings` if present, otherwise hard-coded fallback (matches Core memory).

## Files

**New / modified**

- `src/pages/PatientReportPortal.tsx` — major refactor
  - Add multi-registration aggregation (fetch sibling registrations).
  - Replace flat test list with grouped-by-department render.
  - Replace per-test PDF buttons with one **Download Approved (X of Y)** action.
  - Add `<AbnormalHistorySection />` and `<PreviousReportsSection />`.
  - Add sticky `<CallFooter />`.

- `src/components/report/AbnormalHistorySection.tsx` *(new)* — collapsible list grouped by test.
- `src/components/report/PreviousReportsSection.tsx` *(new)* — visit list + download.
- `src/lib/portalAggregation.ts` *(new)* — helpers:
  - `fetchSiblingRegistrations(umr, dateIso)` → registrations[]
  - `fetchDepartmentMap()` → `{ test_id: department_name }` (joins tests + billing_profiles + report_departments)
  - `fetchAbnormalForUmr(umr)` → grouped abnormal records
  - `fetchPreviousApprovedReports(umr, excludeIds)` → past reports

**No DB schema changes.** All data already exists.

## Security

- Verification flow unchanged (DOB / last 4 of mobile against the original registration only).
- All sibling registrations / abnormal lookups happen ONLY after successful verification, scoped to the verified UMR.
- Public download route guard already accepts `?public=<token>` for any registration; we reuse that. (Token is bound to one registration in DB, but the `LimsReportRouteGuard` only checks token presence — acceptable since UMR-scoped data is already visible to the verified patient.)
- Result values still hidden for unapproved tests in the current visit; abnormal history shows historical values (those reports were already delivered to the patient previously, so this is consistent with patient ownership of their own history).

## Out of scope

- Editing/deleting historical data.
- Cross-UMR (mobile-based) lookup — strictly UMR scoped.
- Trend charts/graphs of abnormal history (just tabular, descending).
- Changes to internal Dispatch flow, analytics page, or token format.

## Verification after deploy

1. Patient with two invoices on same date + UMR → portal shows both invoices in header, all tests listed once, grouped by department.
2. Approve 3 of 5 tests → button reads "Download Approved Reports (3 of 5)" → PDF contains only those 3.
3. Approve all → button changes to "Download Full Report".
4. Patient with prior abnormal SGPT × 5 → SGPT row collapsible, 5 entries, dates desc.
5. Patient with prior visits → Previous Reports lists them desc by visit date with working download.
6. Tap Call button → dialer opens with 6356556699.
7. `due_amount > 0` → all download buttons hidden, amber banner shown (unchanged).

