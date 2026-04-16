
Fix the barcode print layout in `src/components/lims/SampleCollection.tsx` so each tube always consumes exactly one 50mm × 25mm sticker and never spills onto the next one.

1. Correct the actual printable area
- Remove the current `@page { margin: 2mm; }` shrinkage because it reduces the usable label area below the sticker size.
- Make the page exactly match the sticker: `@page { size: 50mm 25mm; margin: 0; }`.
- Make each sticker container exactly fit that page, with `page-break-after: always` and `page-break-inside: avoid`.

2. Rebuild the sticker layout as a fixed-height single-label grid
- Keep one `.label` per tube only.
- Replace the current free-flow vertical stacking with a strict layout that reserves space for:
  - top row
  - patient/location row
  - barcode row
  - barcode text row
  - bottom metadata row
- Use a fixed internal height so browser auto-wrapping cannot push the last line out of the sticker.

3. Prevent text wrapping that causes overflow
- Force the bottom row to stay on one line with `white-space: nowrap`.
- Keep date/time compact and use the project format: `dd-MM-yyyy hh:mm a`.
- Prevent the sample-id row from expanding vertically.
- Truncate long patient/location text instead of letting it wrap to an extra line.

4. Tighten dimensions only where needed
- Keep the barcode readable, but slightly rebalance spacing if needed:
  - preserve scanner-safe barcode rendering
  - reduce only the surrounding text spacing, not barcode quality
- Ensure the barcode image stays within its reserved row and does not stretch the label.

5. Keep one-tube-per-sticker behavior for all print flows
- Apply the fix centrally inside `doPrintBarcodes(...)` so it automatically affects:
  - print during collection
  - single tube print
  - collected sample reprint
  - print all reprint

6. Verify against the exact failure mode
- Recheck with long invoice/sample UID/date combinations like the one shown in your sticker photo.
- Confirm the final bottom line remains inside the same sticker and that the next sticker starts only with the next tube.

Technical details
- Root cause is not barcode font. The main issue is print geometry:
  - page is declared as `50mm × 25mm`
  - but `@page margin: 2mm` reduces printable space to about `46mm × 21mm`
  - while `.label` is still rendered at `48mm × 23mm`
- That mismatch makes the browser/printer paginate part of the label onto the next sticker.
- Secondary overflow risk comes from wrapping text in `.row2`, `.sample-id`, and `.row-bottom`.

Files to update
- `src/components/lims/SampleCollection.tsx`
