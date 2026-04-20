

## Goal
Restrict the test list shown in **New Registration** when a Pickup Point is selected to only the tests that have a custom price configured for that pickup point — instead of showing all tests in the system. Add a toggle so individual pickup points can opt to "show all tests" if needed.

## How it works (user flow)

1. **Default behavior (new):** when a pickup point is selected on the registration form, the "Add Test" search dropdown only shows tests that exist in that pickup point's custom price list (`pickup_point_prices`).
2. If the pickup point has **zero** custom prices configured, the dropdown shows an empty state with a hint: *"No tests configured for this pickup point. Add prices in Settings → Pickup Points."* (No silent fallback — avoids accidental full-list registrations.)
3. **Per-pickup override:** in **Settings → Pickup Points**, each pickup point gets a new toggle **"Allow all tests during registration"** (default = OFF). When ON, that pickup point falls back to showing the full test catalog (current behavior). Custom prices still apply where defined.
4. Channels and non-pickup visit types are **unchanged** — they still show all tests.

## Database (1 migration)

Add a single boolean column to `pickup_points`:

```sql
ALTER TABLE public.pickup_points
  ADD COLUMN allow_all_tests boolean NOT NULL DEFAULT false;
```

No data migration needed — existing pickup points default to the new restricted behavior. (If you'd prefer existing pickup points to default to "allow all" so nothing breaks for current users, say the word and I'll flip the default to `true` for existing rows only.)

## UI changes

### a. `src/components/lims/PatientRegistration.tsx`
- Read `selectedPickup.allow_all_tests` from the already-fetched `pickupPoints` query (no extra query).
- Update the `availableTests` filter:
  - If visit type is `pickup_point` AND a pickup is selected AND `allow_all_tests === false`:
    - Build a `Set` of `test_id`s from `pickupPrices`.
    - Filter `tests` to only those whose `id` is in that set.
  - Otherwise: keep current behavior (full catalog).
- When the filter yields zero tests AND a pickup point is selected with `allow_all_tests === false`, show a small inline hint under the search box: *"No tests configured for this pickup point. Add prices in Settings → Pickup Points → Custom Pricing."*

### b. `src/components/lims/PickupPointManager.tsx`
- In the **Add/Edit Pickup Point** dialog, add a new switch field:
  - Label: **"Allow all tests during registration"**
  - Helper text: *"When off, only tests with a configured custom price will appear during registration for this pickup point."*
- Wire the value into the existing `saveMutation` (insert + update payload).
- Show the current setting in the Pickup Points table as a small badge column: **"All tests"** vs **"Restricted"**.

## Files

### Database migration (new)
- `supabase/migrations/<ts>_pickup_allow_all_tests.sql`

### Edited
- `src/components/lims/PatientRegistration.tsx` — filter logic + empty-state hint.
- `src/components/lims/PickupPointManager.tsx` — toggle in Add/Edit dialog + table badge.

## Out of scope
- Same restriction logic for **Channels** (channels still show all tests). Tell me if you want the same toggle there.
- Same restriction for **Edit Registration** dialog (`EditRegistrationDialog.tsx`) — currently this plan only changes New Registration. Say the word and I'll mirror the behavior there too.
- Bulk-assigning a list of "eligible tests" without setting custom prices (current model = a test is "eligible" iff a custom price exists; this keeps things simple and avoids a second junction table).

