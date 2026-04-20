

## Goal
Speed up Pickup Point custom pricing by:
1. Adding a **search bar** in the Custom Pricing dialog to quickly find tests by name/code.
2. Adding a **"Clone pricing from…"** option in the Add Pickup Point dialog so a new pickup point inherits another pickup point's full custom price list in one click.

## Changes — `src/components/lims/PickupPointManager.tsx`

### 1. Search in Custom Pricing dialog
- Add `pricingSearch` state (debounced not needed — small list, client-side filter).
- Render an `<Input placeholder="Search tests by name or code…" />` sticky at the top of the dialog body.
- Filter the `tests.map(...)` list by `test_name` or `test_code` (case-insensitive) before rendering rows.
- Keep the existing onBlur save behavior unchanged so search filtering doesn't interrupt edits.
- Show "No tests match" empty-state when filter yields nothing.

### 2. Clone pricing in Add Pickup Point dialog
- Add `cloneFromId` state (only used when `editingId` is null — Add mode).
- In the Add dialog, append a new field **"Clone Pricing From (optional)"** with a `<Select>` listing all existing active pickup points (by name). Default = "None".
- Modify `saveMutation`:
  - After the `pickup_points` insert, capture the new id via `.select("id").single()`.
  - If `cloneFromId` is set, fetch all `pickup_point_prices` rows for `cloneFromId`, then bulk-insert them with `pickup_point_id = newId` (preserve `test_id` + `custom_price`).
  - Reset `cloneFromId` in `resetForm()` and on dialog close.
  - On success, toast `"Pickup point created with N cloned prices"` when applicable.
- Field is hidden in Edit mode (only shown when `!editingId`).

### Technical notes
- No DB schema changes — `pickup_point_prices` already has `(pickup_point_id, test_id, custom_price)` with a unique constraint we already use for upsert.
- Bulk clone uses a single `supabase.from("pickup_point_prices").insert([...])` call.
- Search is purely client-side over already-loaded `tests`.

## Files
- **EDIT** `src/components/lims/PickupPointManager.tsx` — add search input + filter; add clone-from select + post-insert copy logic.

## Out of scope
- Cloning to an existing pickup point after creation (only at creation time).
- Cloning between Channels and Pickup Points.
- Bulk Excel import/export of price lists.

