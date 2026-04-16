

## Plan: Append ENTER (Carriage Return) to Barcode Value

### Goal
Append a CR (Carriage Return, ASCII 13) to every barcode so that after the scanner reads it, the machine automatically "presses Enter" — triggering the query to middleware without manual intervention.

### How CODE128 Handles ENTER
CODE128 supports encoding control characters via its **Function Code** set. The ASCII character `\x0D` (CR) is a valid CODE128 character. When the scanner decodes it, it transmits CR to the host — which most analyzers/POS apps interpret as "Enter pressed".

`bwip-js` (already in use) supports embedding raw control characters directly in the `text` parameter when `parsefnc: true` is enabled, OR you can simply append `String.fromCharCode(13)` to the text — bwip-js will encode it natively in CODE128.

### Change

In `src/lib/barcodePrint.ts`, append CR to the barcode value used for encoding (but NOT to the human-readable text printed below the barcode):

```typescript
const cleanSuffix = tube.suffix?.trim();
const displayValue = cleanSuffix ? `${reg.invoice_number}${cleanSuffix}` : reg.invoice_number;
const barcodeValue = `${displayValue}\x0D`;  // ← appended CR for auto-Enter
```

Then:
- Pass `barcodeValue` (with CR) to `renderBarcodePng()` for encoding
- Pass `displayValue` (without CR) to the human-readable text line below the barcode

### Why This Works
- Scanner reads bars → outputs `240416001A` + CR keystroke → analyzer/middleware input field receives the value followed by Enter → query fires automatically
- Same effect as configuring "suffix = CR" on the scanner itself, but baked into the barcode (works regardless of scanner config)
- Display text remains clean (`240416001A`), no visible artifact of the CR

### File
- `src/lib/barcodePrint.ts` — split `barcodeValue` into `displayValue` (text) + `barcodeValue` (encoded with `\x0D`)

### No DB / other file changes

