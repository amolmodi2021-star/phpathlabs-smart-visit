

## Goal
Add a reusable **Standard Price Lists** feature so you can define one or more named price lists once and apply them to any pickup point with a single click — instead of cloning prices pickup-point-by-pickup-point.

## How it works (user flow)

1. In **LIMS → Settings → Pickup Points**, add a new top section: **Standard Price Lists**.
   - Create/rename/delete named lists (e.g. "Standard Hospital Rates", "Premium Partner Rates").
   - Edit each list's prices in a dialog with the same search-and-edit UI used for pickup-point custom pricing.
2. When **adding** or **editing** any pickup point, a new field **"Apply Standard Price List"** lets you select one. On save, all prices from that standard list are copied into that pickup point's `pickup_point_prices` (replacing any existing custom prices for the matching tests; non-matching custom prices are kept).
3. The existing **"Clone Pricing From"** option (clone from another pickup point) stays as an alternative.
4. Standard lists are independent records — editing a standard list later does **not** retroactively update pickup points that previously applied it. (Apply again to re-sync.)

## Database (1 migration)

Two new tables:

```sql
CREATE TABLE standard_price_lists (
  id uuid PK default gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean DEFAULT true,
  created_at, updated_at
);

CREATE TABLE standard_price_list_items (
  id uuid PK default gen_random_uuid(),
  price_list_id uuid REFERENCES standard_price_lists(id) ON DELETE CASCADE,
  test_id uuid NOT NULL,
  custom_price numeric NOT NULL,
  created_at,
  UNIQUE(price_list_id, test_id)
);
```
Open RLS like sibling tables.

## UI changes — `src/components/lims/PickupPointManager.tsx`

### a. New "Standard Price Lists" section (above the Pickup Points table)
- Card with table: Name, # Tests, Status, Actions (Edit Prices / Rename / Delete).
- "Add Standard Price List" button → small dialog (name + description).
- "Edit Prices" opens the same pricing UI used today (search bar + onBlur save), but writes to `standard_price_list_items` instead of `pickup_point_prices`. Reuse the existing render code by extracting it into a small inner component or by parameterizing the table name.

### b. Add/Edit Pickup Point dialog
- Add a new field **"Apply Standard Price List (optional)"** above the existing "Clone Pricing From" field. Default = "None".
- On save (Add or Edit):
  1. Insert/update the pickup point as today.
  2. If a standard list is selected → fetch all its `standard_price_list_items` and **upsert** each into `pickup_point_prices` for this pickup point (`onConflict: pickup_point_id,test_id`).
  3. If "Clone Pricing From" is also selected (Add mode only), the standard list takes precedence; clone is ignored to avoid ambiguity.
  4. Toast: `"Pickup point saved with N prices applied from <list name>"`.
- Available in both Add and Edit modes (so existing pickup points can adopt a standard list).

### c. Pricing dialog (existing) — small addition
- Add a second button next to the search bar: **"Apply Standard Price List"** → small popover to pick a list and re-apply (upsert items). Same logic as above. Useful for re-syncing after the standard list changes.

## Files

### New
- `supabase/migrations/<ts>_standard_price_lists.sql` — 2 tables + RLS.

### Edit
- `src/components/lims/PickupPointManager.tsx` — add Standard Price Lists section, new dropdown in Add/Edit dialog, "Apply" button in pricing dialog, and the upsert logic.

## Out of scope
- Automatic propagation of standard-list edits to all pickup points using it (manual re-apply only).
- Versioning/history of standard price lists.
- Applying a standard list to **Channels** (only Pickup Points for now — say the word and I'll extend it).
- Excel import/export of standard lists.

