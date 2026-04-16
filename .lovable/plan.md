
## Plan: Reprint Barcodes from Sample Acceptance Screen

### What
Add reprint barcode buttons in the **Sample Acceptance** screen (both Pending Acceptance and Accepted tabs) — single-tube reprint and "Print All" for the registration.

### Approach

**1. Extract the shared barcode print helper** (`src/lib/barcodePrint.ts` — new file)
- Move the existing `doPrintBarcodes(reg, tubes)` logic from `SampleCollection.tsx` into a new module so it can be reused without duplication.
- Same exact print HTML/CSS (50mm × 25mm sticker layout, JsBarcode crisp settings) — no behavioral change to current Sample Collection prints.
- Export as `printBarcodes(reg, tubes)`.

**2. Update `src/components/lims/SampleCollection.tsx`**
- Replace local `doPrintBarcodes` with import from the new util. All existing call sites stay identical.

**3. Update `src/components/lims/SampleAcceptance.tsx`**
- Import `printBarcodes` and `Printer` icon.
- **Header row "Print All" button** — added in the Actions column for both Pending and Accepted tabs (next to Accept/Repeat in pending; standalone in accepted). Uses `e.stopPropagation()` so it doesn't toggle the row.
- **Per-tube reprint button** — printer icon inside the expanded sample-detail rows, available in both Pending and Accepted tabs.
- Toast confirmation on each reprint.

### Files
- `src/lib/barcodePrint.ts` (new)
- `src/components/lims/SampleCollection.tsx` (swap to shared util)
- `src/components/lims/SampleAcceptance.tsx` (add buttons)
