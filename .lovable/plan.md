

# Plan: LIMS PDF Report Generation Module

## What it does
Creates a new page (`/lims/report/:registrationId`) that generates production-grade A4 PDF reports from `approved_reports` data. Includes a "View Report" button in the Dispatch section for patients with approved tests. Handles structured test results, snip-only outsourced reports, and mixed reports with strict layout control and intelligent pagination.

## Architecture

```text
Dispatch (button) → /lims/report/:registrationId → LimsReportView.tsx
                                                       ↓
                                          Fetches: approved_reports
                                                   report_layout_settings
                                                   pathologist_signatures
                                                   report_departments (order)
                                                   tests (metadata: instrument, method, sample_type, interpretation)
                                                   test_parameters + parameters (hierarchy, subheaders)
                                                   outsourced_test_snips (snip images)
                                                       ↓
                                          Builds page sections → Paginates → Renders A4 pages
                                          Exports via html-to-image + jsPDF (same as ViewReport.tsx)
```

## Technical Changes

### 1. New Page: `src/pages/LimsReportView.tsx` (~600-800 lines)

**Data Loading:**
- Fetch `approved_reports` by `registration_id`
- Fetch `report_layout_settings` (top_margin_cm, bottom_margin_cm, letterhead_pdf_path)
- Convert letterhead PDF → background image (reuse existing pattern from ViewReport.tsx)
- Fetch `pathologist_signatures` for the approving doctor
- Fetch `report_departments` for display order
- Fetch `tests` with department_id join for each unique test_id in results
- Fetch `test_parameters` with `parameters` join for hierarchy/subheaders per test
- Fetch `outsourced_test_snips` for the registration (snip images)

**Content Type Detection:**
- **CASE A (Structured):** `test_results` array has entries with result values
- **CASE B (Snip-only):** Test has entries in `outsourced_test_snips` with images but 0 results in `test_results`
- **CASE C (Mixed):** Both structured results AND snip images exist

**Blank Parameter Exclusion:**
- Filter out any result where `result_value` is null, empty, or whitespace before rendering

**Section Building (per department, strict new-page-per-department):**
- Group results by department (using test → department_id lookup) → sort by `display_order`
- Within department, group by test/profile → maintain parameter hierarchy from `test_parameters` order + subheaders
- Each department = separate page(s)
- Never split a test/profile across pages — if it doesn't fit, move entire block to next page (still within same department)

**Snip Image Handling:**
- Each snip image gets its own page
- Calculate safe content area = page height - top margin - demographics height - bottom margin - signature height - page number height
- Scale image proportionally to fit within safe area; if too large, move to next page
- No test name, parameter names, reference ranges shown on snip pages — only demographics + image + signature + page number
- Snip pages always rendered AFTER structured results for the same test

**Page Layout (per page):**
1. Top margin (from layout settings)
2. Background template image (letterhead)
3. Patient demographics block (repeats every page) — reuse `ReportHeader` component adapted for LIMS data
4. Content area (structured results OR snip image)
5. Doctor signature (above bottom margin, every page)
6. Page X of Y (near bottom margin)
7. Bottom margin

**Pagination Engine:**
- Pre-calculate heights using constants (ROW_HEIGHT_MM, DEPT_HEADER_MM, etc.)
- Usable height = 297mm - topMargin - bottomMargin - demographicsHeight - signatureHeight - pageNumberHeight
- For each department: start new page, then fit tests/profiles using remaining space
- If a test block exceeds remaining space → new page (still same department header repeated)
- Pre-calculate total pages including snip pages for "Page X of Y"

**PDF Export:**
- Same html-to-image + jsPDF approach as existing ViewReport.tsx
- Print CSS with `@page { size: A4; margin: 0; }` and background rendering

### 2. New Component: `src/components/report/LimsReportHeader.tsx`

Patient demographics adapted for LIMS approved_reports data:
- Patient Name, Age (calculated from DOB) / Gender
- UMR Number, Referring Doctor
- Registration Date, Sample Collection Date, Approval Date, Print Date
- Invoice Number

### 3. Route: `src/App.tsx`
- Add route: `/lims/report/:registrationId` → `LimsReportView`

### 4. Dispatch Button: `src/components/lims/Dispatch.tsx`
- Add "View Report" button (Eye icon) next to WhatsApp button for patients with `all_done` or `partial` status
- Navigates to `/lims/report/:registrationId`
- Update `print_date` in `approved_reports` when PDF is downloaded/printed

## Files Changed
- `src/pages/LimsReportView.tsx` — **new** (main report page)
- `src/components/report/LimsReportHeader.tsx` — **new** (LIMS demographics header)
- `src/App.tsx` — add route
- `src/components/lims/Dispatch.tsx` — add View Report button

