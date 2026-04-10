

# Plan: Letterhead Toggle in Report View

## What it does
Adds a toggle switch in the report toolbar to show/hide the letterhead background. Default is ON (with letterhead). When toggled OFF, the letterhead image is hidden, showing a plain white background — useful for printing on pre-printed stationery.

## Changes

### `src/pages/LimsReportView.tsx`

1. **Add state**: `const [showLetterhead, setShowLetterhead] = useState(true);`
2. **Add toggle in toolbar** (next to Print/Download buttons): A `Switch` + label "With Letterhead"
3. **Conditionally render letterhead image**: Change the letterhead `<img>` block (lines 418-425) to only render when `showLetterhead` is `true`
4. **PDF download**: Pass `showLetterhead` into the `handleDownloadPdf` logic so the downloaded PDF also respects the toggle state (the `toPng` capture will naturally exclude the hidden image)

No database changes needed. Single file edit.

