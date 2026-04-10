

# Plan: Report Styling and Layout Improvements

## Changes

### 1. Bold only abnormal rows (`ReportResultsSection.tsx` — `ParamRow`)
- Parameter name, result value, and reference range get `font-bold` only when flag is H/L/High/Low
- Normal rows: regular weight (remove current `font-semibold` from parameter name)

### 2. Remove Unit column (`ReportResultsSection.tsx`)
- Remove "Unit" column from `TableHeader` — units are already shown in reference ranges
- Remove unit `<td>` from `ParamRow`
- Update column count and widths: Parameter ~40%, Result ~20%, Reference Range ~25%, Flag ~15%
- Adjust descriptive `colSpan` accordingly (now spans Result + RefRange + Flag = 3 cols)

### 3. Descriptive text spanning
- With Unit column removed, descriptive results span remaining columns more naturally
- Adjust `colSpan` values for the new column layout

### 4. Subheader margin (`ReportResultsSection.tsx`)
- Add `pt-3` (more top padding) to subheader rows instead of current `pt-1` so they are clearly distinguished from parameter rows above

### 5. Show Instrument Name and Method (`ReportResultsSection.tsx` + `LimsReportView.tsx`)
- The `buildProfileMetaMap` already maps `instrument` → `analyzer` and `method` — these render via `hasMetaRow` in the component
- Verify that `testsMap` has `instrument_name` and `method` populated (it does — line 136 selects them)
- The meta row renders `Analyzer` and `Method` — ensure this is not hidden by any condition

### 6. Show interpretation for test/profile (`ReportResultsSection.tsx`)
- Profile-level interpretation is already rendered via `hasInterpretation`
- Ensure `buildProfileMetaMap` passes `interpretation` (it does — line 694)
- Verify it renders when present — the logic looks correct, so this may be a data issue. Will add debug check.

### 7. Print-friendly styles — remove backgrounds (`ReportResultsSection.tsx`)
- Department header: replace `bg-[#2E3192] text-white` with `border-2 border-gray-800 text-gray-900 font-bold` (no background fill)
- Profile header: replace `bg-blue-50` with `border-b-2 border-gray-600` (no background)
- Abnormal row: remove `bg-red-50` highlight — instead use bold text + red color only
- Test group sub-header: remove `bg-gray-50`
- These changes save printer ink while keeping visual hierarchy via borders and font weight

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — all styling changes
- `src/pages/LimsReportView.tsx` — verify data flow only, no changes expected

