

## Issue: Trailing Spaces After Suffix in Barcode

### Root Cause
Line 75 constructs the barcode value:
```typescript
const barcodeValue = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;
```

If `tube.suffix` contains trailing spaces (e.g., `"A "` instead of `"A"`), the barcode will include those spaces, which can cause scanner failures or misreads.

### The Fix
Trim the suffix before concatenating it to the invoice number:

```typescript
const barcodeValue = tube.suffix 
  ? `${reg.invoice_number}${tube.suffix.trim()}` 
  : reg.invoice_number;
```

This ensures any leading/trailing whitespace in the suffix column is stripped before encoding into the CODE128 barcode.

### Why This Matters
- CODE128 scanners interpret spaces as valid characters → `240416001A ` and `240416001A` are different barcodes
- Trailing spaces from database entry or Excel imports would break sample lookup in Results Entry / Sample Acceptance
- `.trim()` is safe even if suffix is already clean (idempotent)

### File
- `src/lib/barcodePrint.ts` — line 75 only

