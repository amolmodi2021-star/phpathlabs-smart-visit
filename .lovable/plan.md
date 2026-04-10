

# Plan: Strip Background Colors and Force Black Text for Print

## Problem
The print workflow captures pages as PNG images using `html-to-image` before sending to the print dialog. Since the capture happens on the live DOM with all colors intact, Tailwind's `print:` utilities have no effect — the image bakes in the blue department headers, blue test name boxes, red abnormal row highlights, and colored text.

## Solution
Before capturing images in `handlePrint`, temporarily add a CSS class to the print container that forces all colors to black and removes all backgrounds. Remove it after capture.

### Changes — `src/pages/LimsReportView.tsx`

In `handlePrint`, after hiding letterhead and before capturing images:
1. Add a class `print-strip-colors` to `printRef.current`
2. Wait a tick for repaint
3. Capture images as usual
4. Remove the class after capture

### Changes — `src/index.css` (or `src/App.css`)

Add a utility class that, when applied, overrides all descendant styles:

```css
.print-strip-colors,
.print-strip-colors * {
  background-color: transparent !important;
  background: transparent !important;
  color: black !important;
  border-color: #d1d5db !important;
}
.print-strip-colors .flag-badge {
  background-color: transparent !important;
  color: black !important;
}
```

This ensures:
- Department header: no blue bg, black text
- Profile/test name box: no blue-50 bg, black text  
- Abnormal rows: no red-50 bg, black text
- Flag badges: no red bg, black text
- Instrument/method/interpretation: black text
- Bold styling is preserved (only `color` and `background` are overridden)

### Files Modified
- `src/pages/LimsReportView.tsx` — 3 lines added in `handlePrint`
- `src/index.css` — ~10 lines of CSS added

