
## Root cause
The report you are viewing is rendered by `src/pages/LimsReportView.tsx`, not by `src/components/report/ReportResultsSection.tsx`.

That is why:
- only the patient demographics changed (`LimsReportHeader.tsx` is actually used here)
- department name, test name, table headers, and parameter rows stayed tiny
- descriptive results still wrap inside the narrow Result column

`LimsReportView.tsx` still has hardcoded very small inline sizes like:
- main content `9px`
- department `11px`
- test name `10px`
- table header `8px`
- metadata/interpretation `8px`

## What I will change

### 1. Increase the actual report font sizes in `src/pages/LimsReportView.tsx`
Update the live report page so mobile readability improves visibly:
- Department name: increase substantially
- Test name: increase substantially
- Table headers: increase substantially
- Parameter/result/unit/reference/flag rows: increase substantially
- Subheaders inside tests: increase too
- Interpretation and metadata: increase slightly so they remain readable but secondary

### 2. Fix descriptive-result layout in `src/pages/LimsReportView.tsx`
Update `renderParamRow()` so when a row is descriptive and has no unit, no reference range, and no flag:
- the result text will span across the full right-side area
- instead of staying inside only the Result column

This means using a spanning cell for the descriptive text so it occupies:
`Result + Unit + Reference Range + Flag` space

```text
Current:
| Parameter | Result text wraps | Unit | Ref Range | Flag |

Target:
| Parameter | Descriptive text uses the whole remaining width          |
```

### 3. Keep long patient names wrapping cleanly
Retain the patient-name wrapping already added in `src/components/report/LimsReportHeader.tsx`.

### 4. Adjust page-height estimates in `src/pages/LimsReportView.tsx`
Because larger fonts make rows taller, I will also update the pagination/height constants so:
- rows do not collide
- test blocks do not overflow awkwardly
- PDF/export layout remains stable

## Files to update
- `src/pages/LimsReportView.tsx` — main fix
- `src/components/report/LimsReportHeader.tsx` — keep current demographic wrapping, only touch again if needed for balance

## Technical details
- Replace tiny inline font sizes in the report view with larger values used consistently across headers and rows
- Update the parameter-row renderer to branch like:
  - normal numeric row -> standard 5-column layout
  - descriptive row with no unit/range/flag -> `colSpan={4}` for the right side
- Revisit row/header height constants so the multi-page report layout still paginates correctly

## Expected outcome
After this change, on `/lims/report/...`:
- department names will look clearly larger
- test names will look clearly larger
- column headers and parameter rows will be readable on mobile
- descriptive results will stretch across the available right-side width instead of wrapping inside the Result column
