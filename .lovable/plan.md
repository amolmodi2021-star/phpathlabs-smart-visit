

## Problem
The View Report screen renders each page as a fixed A4 sheet (`width: 210mm`, `height: 297mm`). On mobile (e.g. 931×641 or smaller real phones at ~390px), this means:
- The page is wider than the screen → horizontal scroll + pinch-zoom required.
- Toolbar (Back, title, With Letterhead toggle, Print, Download PDF) is laid out in a single horizontal row with `ml-auto` — wraps badly / overflows on narrow screens.
- Title `Report — {patient_name} ({invoice_number})` is `text-xl` and fights for space.
- `flex items-center gap-3` toolbar doesn't wrap.

## Constraint (must preserve)
- The A4 page DOM (`#print-container > [data-page]`) MUST stay at exactly 210mm × 297mm because:
  - `html-to-image` + `jsPDF` capture this DOM at fixed dimensions for PDF download.
  - Print uses the same DOM.
  - All clinical pagination math (`PAGE_HEIGHT_MM`, `AutoScaleContent`, signature placement) depends on it.
- So we cannot simply make the page responsive — we must **scale the A4 view down to fit the mobile viewport** purely as a CSS visual transform, leaving the underlying DOM untouched.

## Fix plan (single file: `src/pages/LimsReportView.tsx`)

### 1. Responsive toolbar
Replace the single-row toolbar (`flex items-center gap-3`) with a wrapping layout:
- On mobile: stack into 2 rows — row 1 = Back button + compact title (truncated), row 2 = Letterhead toggle + Print + Download PDF (icon-only on smallest screens).
- On desktop: keep current single-row layout.
- Use `flex-wrap`, `text-base sm:text-xl`, `truncate`, and hide button labels at `<sm` (icon only, with `aria-label`).

### 2. Auto-scaling A4 preview on mobile
Wrap the rendered pages in a container that:
- Measures the available viewport width (`window.innerWidth` minus side padding).
- Computes A4 width in px at 96dpi: `210mm ≈ 794px`.
- If viewport width < 794 + margin → apply CSS `transform: scale(viewportWidth / 794)` with `transform-origin: top center` to each page wrapper.
- Adjust the wrapper's effective `height` (`pageHeightPx * scale`) and `margin-bottom` so vertical spacing stays correct after scaling (otherwise scaled pages overlap their layout box).
- The capture/PDF/print path is unaffected because it operates on `printRef` DOM at native 210mm sizing — we only scale the on-screen preview wrapper, not the print container itself for capture.

Implementation approach:
- Add a `useState` for `previewScale`, `useEffect` with `ResizeObserver` on the parent to recompute on resize/orientation change.
- During PDF capture (`handleDownloadPdf`) temporarily reset scale to 1 before `toPng` runs, then restore (the existing capture already operates element-by-element via `data-page`, so we'll set scale only on a CSS variable / wrapper class that capture bypasses by reading the inner `[data-page]` element directly at its natural 210mm size — which it already does via `getBoundingClientRect`-independent fixed mm sizing).
- Safer pattern: apply scale to an outer wrapper `<div className="page-shell">` containing the existing `[data-page]`. The capture code reads `[data-page]` → unaffected by ancestor transform when using `html-to-image` with explicit `width`/`height` options matching the native size. Quick verification needed via the existing `handleDownloadPdf` code; if it does rely on layout box, we wrap capture in a `scale=1` toggle.

### 3. Padding & overflow
- Reduce outer `p-4` to `p-2 sm:p-4` on the root container.
- Allow horizontal scrolling as a fallback only when scaling is at the floor (just in case).

### 4. Verification step needed
Need to peek at `handleDownloadPdf` to confirm it captures from the native-mm DOM independent of ancestor transforms. If it captures the parent, we'll temporarily strip the transform during capture (already a known pattern). Will inspect during implementation.

## Files
- `src/pages/LimsReportView.tsx` — toolbar refactor + scaling wrapper + resize listener (~40 lines net).

## Out of scope
- No change to PDF output, print output, A4 dimensions, pagination, signatures, or `ReportResultsSection`.
- No change to `LimsReportHeader` (it stays inside the fixed-width A4 page; it scales with the page).
- No new component files unless capture-isolation requires one.

