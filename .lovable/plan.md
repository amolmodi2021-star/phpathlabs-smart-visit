
## Fix plan for invoice 2604150008 overflow

### Why the current logic is failing
The current “dedicated summary page” check in `src/components/lims/InvoicePreview.tsx` is too weak, so it often never triggers:

- it only pushes a new page when `last page test count > lastPageCapacity`
- for bills like `2604150008`, the last page is likely landing at exactly the threshold, not above it
- there is also a `pages.length > 1` guard, so a single full test page can still keep the summary on the same page
- the summary height estimate is optimistic, and refund + cancelled tests + barcode + footer together are taller than the reserved space

### What I will change
#### 1. Make summary-page splitting explicit and conservative
In `src/components/lims/InvoicePreview.tsx`:
- keep filling test pages forward so page 1 stays full
- after pages are built, calculate a stricter `safeLastPageCapacity`
- if the final test page is at or near that limit, append a dedicated summary-only page

This will use `>=` instead of `>` and will work even when there is only one test page.

#### 2. Add extra safety buffer for complex summaries
Reduce the usable last-page test capacity further when any of these exist:
- refund section
- cancelled tests text
- barcode
- multiple payment rows
- due amount / long “received with thanks” text

This avoids relying on exact row math.

#### 3. Render true summary-only last page
When the added last page has no tests:
- do not render the tests table at all
- show only header + patient details + payment summary + refund details + barcode + footer

That gives the summary maximum vertical space and prevents an empty table from wasting room.

### Expected behavior after fix
- Page 1 stays filled with tests as much as possible
- if the last test page does not have safe room for payment/refund/barcode, those sections move to a fresh next page
- no barcode or refund block should overflow beyond the printable A5 page

### File to update
- `src/components/lims/InvoicePreview.tsx`

### Validation after implementation
I will verify specifically with invoice `2604150008` and check:
- first page remains properly filled
- summary/refund/barcode moves to a separate page when needed
- no empty test table appears on the summary-only page
- print output matches preview behavior correctly
