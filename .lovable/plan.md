

## Plan: Sample Type, Outsourced, Interpretation Fields + Auto-Apply in Report

### Overview

Add `sample_type`, `is_outsourced`, `outsourced_caption`, and `interpretation` fields to both profiles and parameters. These are NOT added during extraction/review -- they are auto-applied at report generation time in `ViewReport.tsx` by looking up master data for matched profiles/parameters.

---

### Step 1: Database Migration

Add columns to **`report_profiles`**:
- `sample_type TEXT`
- `is_outsourced BOOLEAN DEFAULT false`
- `outsourced_caption TEXT`
- `interpretation TEXT` (stores rich HTML)

Add columns to **`report_test_parameters`**:
- `sample_type TEXT`
- `is_outsourced BOOLEAN DEFAULT false`
- `outsourced_caption TEXT`
- `interpretation TEXT` (stores rich HTML)

---

### Step 2: Update Profile Management (`ReportProfiles.tsx`)

Add to the edit/add dialog:
- **Sample Type** -- text input
- **Is Outsourced** -- checkbox
- **Outsourced Caption** -- text input, visible when outsourced checked
- **Interpretation** -- rich text editor

Add **Sample Type** column to the listing table. Show "Outsourced" text indicator in the table.

---

### Step 3: Update Parameter Management (`ReportParameters.tsx`)

Same fields as profiles:
- **Sample Type**, **Is Outsourced**, **Outsourced Caption**, **Interpretation**

Add Sample Type column to listing table.

---

### Step 4: Rich Text Editor Component

Create `src/components/RichTextEditor.tsx` using `contentEditable` div with toolbar:
- Bold, Italic, Underline
- Bullet list, Numbered list
- Image insert (upload to `report-uploads` bucket)

Stores/returns HTML string. Lightweight, no new dependencies.

---

### Step 5: Auto-Apply in ViewReport.tsx (Report Generation)

In `loadReport()`, after matching parameters to master data, also fetch:
- Profile master data (`sample_type`, `is_outsourced`, `outsourced_caption`, `interpretation`, `analyzer`, `method`) for all matched profile names
- Parameter master data (same fields) for standalone parameters

Enrich each `TestResult` with new optional fields: `sample_type`, `is_outsourced`, `outsourced_caption`, `interpretation`, `analyzer`, `method`.

---

### Step 6: Report Rendering (`ReportResultsSection.tsx`)

After each profile's results table, render (if data exists):

1. **Metadata row** -- grouped line showing Sample Type, Analyzer, Method (from profile for grouped params, from parameter for standalone)
2. **Outsourced caption line** -- if profile/parameter is outsourced, show the editable caption text as a simple italic line (no badges)
3. **Interpretation block** -- render rich HTML:
   - Profile-level interpretation for grouped parameters
   - Parameter-level interpretation for standalone (non-profile) parameters

Pass these new fields via extended `TestResult` interface and new optional props on `ReportResultsSection`.

---

### Step 7: Pagination Height Adjustments

Add height estimates in `ViewReport.tsx` for new sections:
- Metadata row: ~4mm
- Outsourced caption: ~4mm  
- Interpretation: estimate based on content length (~6mm base + variable)

---

### Files to Create/Modify

1. **Migration** -- add columns to `report_profiles` and `report_test_parameters`
2. **New**: `src/components/RichTextEditor.tsx`
3. **Modified**: `src/pages/ReportProfiles.tsx` -- add new fields to form/table
4. **Modified**: `src/pages/ReportParameters.tsx` -- add new fields to form/table
5. **Modified**: `src/pages/ViewReport.tsx` -- fetch master data at render time, enrich results, pass metadata to rendering
6. **Modified**: `src/components/report/ReportResultsSection.tsx` -- render metadata, outsourced caption, interpretation below each profile/parameter block

