

# Plan: Fix Vertical Lines Around Test Name in Print Mode

## Problem
The department content is wrapped in a `<div className="border ...">` container (line 196). When `print-strip-colors` strips backgrounds, this container's left/right borders remain visible as two vertical lines flanking the test name header. The header itself only has `border-b-2` (bottom border), so the box looks incomplete.

## Solution
Complete the box around the profile header by changing its `border-b-2 border-gray-600` to a full border (`border-2 border-gray-600`). This way, when printed, the test name has a clean complete rectangle instead of orphaned vertical lines from the parent container.

Additionally, hide the parent container's border in print-strip mode so it doesn't double up with the header's own border.

## Changes

### `src/index.css`
Add a rule to remove borders from the department content wrapper in print-strip mode:
```css
.print-strip-colors [data-pdf-section="department"] > .border {
  border-color: transparent !important;
}
```

### `src/components/report/ReportResultsSection.tsx`
**Line 304** — Change the profile header from `border-b-2` to `border-2` so it renders as a complete box:
```
border-b-2 border-gray-600  →  border-2 border-gray-600
```

This gives the test name a clean bordered box in print, matching the reference image showing "Complete Blood Count (Sample: WHOLE BLOOD)" inside a complete rectangle.

### Files Modified
- `src/index.css` — 3 lines added
- `src/components/report/ReportResultsSection.tsx` — 1 line changed

