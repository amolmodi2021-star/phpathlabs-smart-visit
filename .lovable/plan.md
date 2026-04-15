

# Fix: Allow Summary to Spill to Dedicated Next Page When Tests Fill the Space

## Problem
When tests consume most of the page, the payment summary and barcode overflow beyond the page boundary. The current forward-fill logic tries to reserve space on the last page for the summary, but the height estimates are imprecise, causing overflow.

## Solution
Add a safety check: if the last page's test count equals `normalPageCapacity` (meaning tests filled it completely), push the summary to a new dedicated page with no tests. This guarantees the summary never overflows.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. After page distribution (around line 190), add overflow protection
If the last page has tests filling it to `normalPageCapacity` or more, OR if the last page's test count exceeds `lastPageCapacity`, push an empty page for the summary:

```typescript
// If last page is too full for summary, add a dedicated summary-only page
if (pages.length > 0 && pages[pages.length - 1].length > lastPageCapacity) {
  pages.push([]); // empty page just for summary
}
```

### 2. Update the rendering loop (around line 265-342)
Handle the case where a page has zero tests — skip the table rendering but still show the header, demographics, summary, and footer. The `isLast` check already gates the summary, so an empty last page will simply render header + summary + barcode + footer.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — ~5 lines added/modified.

