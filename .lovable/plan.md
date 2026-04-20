

## Goal
Make the **Custom Pricing** and **Standard Price List** dialogs much wider so the test name, base price, and custom price columns all fit without horizontal scrolling.

## Change — `src/components/lims/PickupPointManager.tsx`

Both pricing dialogs currently use the default `DialogContent` width (`max-w-lg` = ~32rem). I'll widen them to use the full viewport comfortably:

- **Pricing dialog `DialogContent`**: change `className` to `max-w-5xl w-[95vw] max-h-[85vh] flex flex-col` so it spans up to ~64rem (and 95% of viewport on smaller screens).
- **Standard Price List items dialog `DialogContent`**: same `max-w-5xl w-[95vw] max-h-[85vh] flex flex-col`.
- **Inner scroll area**: wrap the table in a `flex-1 overflow-y-auto` container so the dialog header/search bar stay sticky and only the test list scrolls vertically — no horizontal scroll needed.
- **Table column widths**: set explicit widths so columns balance nicely:
  - Test Code: `w-32`
  - Test Name: flexible (no width — takes remaining space)
  - Base Price: `w-28 text-right`
  - Custom Price input: `w-32 text-right`
- Remove any `overflow-x-auto` wrapping that was forcing horizontal scroll.

No DB changes, no logic changes — purely a layout/sizing tweak on the two dialogs.

## Files
- **EDIT** `src/components/lims/PickupPointManager.tsx` — widen both pricing dialogs and rebalance column widths.

## Out of scope
- Changing the Add/Edit Pickup Point dialog size (it fits fine).
- Changing default dialog width globally (`ui/dialog.tsx`) — only the two pricing dialogs need to be wider.

