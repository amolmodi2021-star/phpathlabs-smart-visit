

# Add "Prepared by" and "Printed by" Footer on Every Invoice Page

## What changes
Add a footer at the bottom of every printed page showing:
- **Left side**: `Prepared by: {registered_by} | {registration date/time}`
- **Right side**: `Printed by: {current logged-in username} | {current date/time}`

Also update the in-dialog preview and WhatsApp image to show the same footer.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Import `getCurrentUserName` from auth
Add `import { getCurrentUserName } from "@/lib/auth"` to get the currently logged-in user's display name for "Printed by".

### 2. Add footer HTML to every page in `handlePrint`
Move the "Prepared by" line out of the last-page-only summary block. On every page (inside the `pages.forEach` loop), append a bottom-pinned footer div:

```
Left:  Prepared by: {data.registered_by} on {format(createdAt, "dd-MM-yyyy hh:mm a")}
Right: Printed by: {currentUser} on {format(now, "dd-MM-yyyy hh:mm a")}
```

Remove the existing `Prepared by` line from the summary section (line 285) since it moves to the per-page footer.

### 3. Update the in-dialog preview footer (around line 484)
Replace the centered "Prepared by" text with a flex row showing prepared-by on the left and printed-by on the right, matching the print layout.

### 4. Styling
Use `display:flex; justify-content:space-between; font-size:9px; color:#888` for the footer row. The "printed by" timestamp will be generated at print/render time using `new Date()`.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

