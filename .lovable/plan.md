

## Issue: Machine Cannot Read Barcode — Root Cause Analysis

### Investigation
Looking at `src/lib/barcodePrint.ts`, the barcode value passed to `bwip-js` is:
```typescript
const barcodeValue = `${displayValue}\x0D`;  // appended CR (ASCII 13)
```

This CR character is being **encoded into the CODE128 barcode itself** (as a Code C/Function shift), making the bars contain a non-printable control character.

### Why Machines Fail to Read It
1. **Most lab analyzer scanners reject control characters in the barcode payload.** They expect alphanumeric data only — embedded CR (`\x0D`) makes the decoded string contain a non-ASCII-printable byte, which the analyzer's middleware parser drops or treats as malformed.
2. **CODE128 encoding of control chars uses Code A subset**, which forces a subset switch mid-barcode. Some lower-end scanners (especially CCD/laser, not 2D imagers) fail to decode the subset shift correctly → no read at all.
3. The "Enter after scan" behavior is **NOT** supposed to come from the barcode data — it's supposed to come from the **scanner's suffix configuration** (a one-time scanner setting: scan a "Add CR Suffix" config barcode from the scanner manual).
4. Even when scanners do read it, they output `240416001A` followed by CR — but the CR being **inside** the barcode data confuses the lookup because the value stored in DB is `240416001A` (no CR), so exact-match lookup fails.

### The Fix
**Remove the CR from the barcode payload entirely.** The "auto-Enter" behavior should be configured on the scanner itself (universal scanner feature), not baked into the barcode.

```typescript
// BEFORE (broken)
const barcodeValue = `${displayValue}\x0D`;

// AFTER (fixed)
const barcodeValue = displayValue;  // clean alphanumeric only
```

### How to Get "Auto-Enter" After Scan (Correct Method)
Configure the scanner one time:
- **Honeywell/Datalogic/Symbol/Zebra scanners**: Scan the "Add CR Suffix" or "Enter Key Suffix" config barcode from the scanner's user manual (usually page 1-2 of "Suffix Setup" section)
- **Generic USB scanners**: Most ship with CR+LF suffix enabled by default
- This is a **scanner-side** configuration — the barcode itself must contain only the data

### Changes
- `src/lib/barcodePrint.ts` — remove `\x0D` from `barcodeValue`, use `displayValue` directly for both encoding and display

### File
- `src/lib/barcodePrint.ts` — line ~76 only

### No DB / other file changes

