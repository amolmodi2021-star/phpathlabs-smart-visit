

# Fix: Fill First Page Fully Before Spilling to Next Page

## Problem
The current pagination algorithm works **backward** — it reserves `lastPageCapacity` rows for the final page, then puts only the remainder on earlier pages. This causes page 1 to have very few tests (e.g., 7 out of a possible 19) while the last page is packed.

## Solution
Change the distribution to work **forward**:
1. Fill each page to `normalPageCapacity` (≈19 rows)
2. After filling, check if the remaining tests fit within `lastPageCapacity`
3. If they do, put them on the last page — done
4. If they don't, continue filling another normal page and re-check

This ensures page 1 is always full before any overflow goes to page 2.

## Change in `src/components/lims/InvoicePreview.tsx` (lines 171-188)

Replace the backward-reserve loop with a forward-fill loop:

```typescript
const pages: any[][] = [];
const totalTests = tests.length;
if (totalTests <= lastPageCapacity) {
  // Everything fits on one page with summary
  pages.push(tests);
} else {
  let idx = 0;
  let remaining = totalTests;
  // Fill pages to normalPageCapacity until remainder fits on last page
  while (remaining > lastPageCapacity) {
    const take = Math.min(normalPageCapacity, remaining);
    pages.push(tests.slice(idx, idx + take));
    idx += take;
    remaining -= take;
  }
  if (remaining > 0) {
    pages.push(tests.slice(idx)); // last page with summary
  }
}
```

### Single file change
- `src/components/lims/InvoicePreview.tsx` — ~10 lines rewritten in the page-splitting block.

