

## Goal
Fix barcode sticker layout so left edge text isn't clipped, drop the `S…` sample UID, and make patient name + sample ID more readable. **Zero changes to barcode rendering, image, position, dimensions, or quiet zone** — only text content/sizing/positions.

## Issues from photo
- Left edge of text is clipped (invoice number "2604170001" prints as "604170001", "AMOL" prints as "MOL"). Caused by `x = 1mm` being inside the printer's non-printable margin.
- Patient name "AMOL MODI" partially cut at the start.
- Sample type "WHOLE BLOOD" / "PLASMA" partially cut ("VHOLE BLOOD", "LASMA").
- Sample ID line shows redundant `S26041700001` — user wants only the invoice/suffix portion.
- Patient name + sample ID feel small.

## Fix plan — `src/lib/barcodePrint.ts` only

In the `tubes.forEach(...)` block (lines 75–109):

1. **Increase left margin** for ALL text from `x = 1` → `x = 3.5` (mm). Mirror right side from `49` → `46.5` so right-aligned items also stay inside the printable area. Update `splitTextToSize` width from `48` → `43` to match the new safe width.

2. **Row 1 — invoice number bigger**: bump font size from `7` → `8.5` (bold, unchanged otherwise). Age/sex stays at 7 on the right.

3. **Row 2 — patient name bigger**: bump font size from `6.5` → `8` (bold). Keep location suffix `"  PH <loc>"` truncation logic, just with the new 43mm width.

4. **Sample ID line — remove `S…` UID, make bigger**:
   - Replace `const sampleLine = \`${displayValue}  ${tube.sample_uid}\`` with `const sampleLine = displayValue` (just `2604170001` or `2604170001-R`).
   - Bump font size from `5.5` → `8` (bold), keep centered at `x=25, y=20.5`.

5. **Bottom row — sample type bold**: change `doc.setFont("helvetica", "normal")` → `doc.setFont("helvetica", "bold")` for this row. Font size stays `6`. Datetime stays bold too (it already inherits). Use new `x = 3.5` for sample type and `x = 46.5` for datetime.

## Explicitly NOT touching
- `renderBarcodePng()` — untouched.
- Barcode `addImage(png, "PNG", 6.5, 7.5, 37, 10, …)` — same x, y, width, height, quiet zone. No risk of yesterday's scanner issue recurring.
- Page size `[50, 25]`, orientation, font family, iframe print pipeline — all unchanged.
- `barcodeValue` payload — unchanged (still pure alphanumeric, scanner-safe).

## Files
- `src/lib/barcodePrint.ts` — text-layout-only edits to lines 75–109 (~10 lines changed).

