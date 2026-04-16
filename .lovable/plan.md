

# Fix: Barcode Label Content Overflowing to Next Sticker

## Problem
The bottom line (`2604110004-F S2604110010`) of the barcode label is overflowing onto the second sticker. The label content exceeds the 25mm sticker height.

## Root Cause
In `src/components/lims/SampleCollection.tsx` (line 253-262), the label is set to `height: 23mm` with `padding: 1.5mm`, leaving ~20mm usable. The combined content (header rows + patient name + 8mm barcode + sample ID + sample type/date row) slightly exceeds this, pushing the last line onto the next sticker.

## Fix — `src/components/lims/SampleCollection.tsx`

Adjust the label CSS to ensure all content fits within a single sticker:

1. **Reduce barcode height** from `8mm` to `7mm` — saves 1mm
2. **Reduce padding** from `1.5mm` to `1mm` — saves 1mm
3. **Reduce margins** between rows from `0.5mm` to `0.3mm`
4. **Reduce sample-id font** from `7pt` to `6pt`
5. **Add `overflow: hidden`** as a safety net (already present, just confirming)

These small reductions together free ~3mm, ensuring the sample ID and tube info stay on the same sticker.

## Single file change
- `src/components/lims/SampleCollection.tsx` — lines 252-281 (CSS and label HTML adjustments)

