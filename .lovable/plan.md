

# Plan: Restore Background Colors for Screen, Remove Only for Print

## What changed incorrectly
The previous update removed background colors entirely (department headers, profile headers, abnormal row highlights). The user wants these colors **visible on screen** but **hidden when printing** (via the Print button).

## Changes

### `src/components/report/ReportResultsSection.tsx`

1. **Department header** — restore `bg-[#2E3192] text-white` and add `print:bg-transparent print:text-gray-900 print:border-2 print:border-gray-800`
   - On screen: blue background with white text
   - On print: no background, dark text with border

2. **Profile header** — restore `bg-blue-50` and add `print:bg-transparent`

3. **Abnormal rows** — restore `bg-red-50` highlight and add `print:bg-transparent`

4. **Test group sub-headers** — restore `bg-gray-50` and add `print:bg-transparent`

All other recent changes (bold only for abnormal, no Unit column, subheader spacing, instrument/method display, interpretation) remain untouched.

### How print classes work
Tailwind's `print:` variant applies only inside `@media print`. The LIMS print flow uses `window.print()` or captures via html-to-image — the print CSS media query strips backgrounds automatically. For the image-capture PDF flow, the existing letterhead-off logic already handles background removal, so this aligns with both paths.

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — ~4 lines changed (restore bg classes + add print: overrides)

