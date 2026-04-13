

# Advisory/Multi-Category Reference Ranges (e.g. HbA1c)

## The Problem
For parameters like HbA1c, there are multiple clinical categories (Normal: <5.7, Pre-Diabetic: 5.7–6.4, Diabetic: ≥6.5). You want to:
1. Flag anything outside "Normal" as abnormal (H)
2. Show **all** categories in the report's Reference Range column

## How It Already Works (Almost)
Your system already supports this — you just need to use the fields correctly:

- **Low / High** → Set to the "Normal" bounds (e.g., Low = blank, High = 5.6). This drives the H/L flag logic.
- **Display Text** → Enter the full multi-line reference text that shows all categories. This is what appears in the report.

The flag engine (`reportFlags.ts`) already uses Low/High for flagging, and the report renders `normal_range_text` (Display Text) in the Reference Range column.

## What's Missing
The current numeric range UI auto-generates Display Text from Low/High, which doesn't work for advisory ranges. We need a small enhancement:

### Change: `src/pages/ReportParameters.tsx`
- Add a toggle **"Advisory Range"** (or "Multi-category Range") checkbox on numeric range type parameters.
- When enabled:
  - Low/High fields remain (used for flagging the "normal" bounds)
  - Display Text becomes a **multi-line textarea** instead of a single-line input, so you can enter:
    ```
    Non-Diabetic: < 5.7%
    Pre-Diabetic: 5.7 - 6.4%
    Diabetic: ≥ 6.5%
    ```
  - Display Text is NOT auto-populated from Low/High — it stays manual.

### Change: `src/components/report/ReportResultsSection.tsx`
- In the Reference Range column, if `normal_range_text` contains newlines, render each line on its own line (using `whitespace-pre-line` or `<br/>` splits) so the multi-category ranges display neatly in the report.

### No changes needed to:
- Flag logic (`reportFlags.ts`) — already uses Low/High for numeric flagging
- Result Entry / Verification / Approval — they already display `referenceRange` text as-is
- Database schema — `normal_range_text` is already a text field that can hold multi-line content

## Summary
Two small UI changes: a toggle + textarea in parameter management, and multi-line rendering in the report. The existing flag engine handles the rest.

