

## Goal
Make it easy to **remove tests** from a Pickup Point's (or Standard Price List's) custom price list — either one-by-one with checkboxes, in **bulk via multi-select**, or **delete all** at once. Today the only way to remove a configured test is to clear its custom price input and tab away, which is unintuitive.

## Changes — `src/components/lims/PickupPointManager.tsx` (PriceEditor component)

### 1. Add a "Configured only" view toggle
A small toggle at the top of the price editor:
- **"Show: All tests / Configured only"** (default = **Configured only** when there is at least one configured price; otherwise All tests).
- "Configured only" hides every test that has no custom price row, so the list focuses on what you've actually set up and can remove. "All tests" keeps current behavior for adding new prices.

### 2. Add a checkbox column + selection state
- New leftmost column with a per-row checkbox (only enabled for rows that have a configured custom price — you can't "delete" what isn't configured).
- Header row gets a master checkbox: **select all currently visible configured rows**.
- Local state: `selectedTestIds: Set<string>`. Reset whenever the dialog opens or after a successful bulk delete.

### 3. Add a bulk action bar
Appears above the list whenever there is ≥1 selection or ≥1 configured price:
- **Selected count** indicator (e.g. "3 selected").
- **"Remove selected"** button — disabled until ≥1 selected. Confirm dialog: *"Remove N custom prices? Tests will revert to base price."*
- **"Remove all configured prices"** button (destructive style, right-aligned). Confirm dialog: *"Remove ALL N custom prices for this pickup point? This cannot be undone."*

Both actions call a single `supabase.from(table).delete().eq(ownerCol, ownerId)` (for "all") or `.in("test_id", ids)` (for "selected"), then invalidate the query and toast the result.

### 4. Per-row trash icon (quick remove)
Replace the awkward "blank the input to delete" UX with an explicit **trash icon button** at the end of every row that has a configured price. Clicking it deletes just that row (with a small inline confirm via `window.confirm`, no extra dialog).

### 5. Empty-state copy
- When "Configured only" is selected and there are zero configured prices: show *"No tests configured yet. Switch to 'All tests' to add custom prices."*

### Technical notes
- Reuses the existing `delMut` mutation for single-row deletes.
- Adds two new mutations:
  - `bulkDelMut(ids: string[])` → `.in("test_id", ids)`.
  - `deleteAllMut()` → `.eq(ownerCol, ownerId)` with no test_id filter.
- Works for **both** Pickup Point custom pricing AND Standard Price Lists (same `PriceEditor` component, same code path).
- No DB schema changes.

## Files
- **EDIT** `src/components/lims/PickupPointManager.tsx` — extend `PriceEditor` with view toggle, checkboxes, bulk action bar, per-row trash button, and the two new mutations.

## Out of scope
- Bulk-add tests by Excel import (separate feature).
- Undo/restore of deleted prices.
- Any change to `PatientRegistration.tsx` (the new restricted-list filter already correctly hides tests that have been removed).

