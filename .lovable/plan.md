
## Goal
In the LIMS Bidirectional Interface ("Active Orders" card on `/lims-demo`):
1. **Auto-delete** active orders once the underlying registration has been dispatched (via the Dispatch button or WhatsApp send).
2. Add **selection UI** (checkbox per row + select-all), **Delete Selected**, **Delete All**.
3. Add a **search bar** to filter active orders (by Sample ID / Patient Name) so users can target rows for selection/deletion.

## How "dispatched" is detected
A `lims_test_orders.sample_id` is the registration `invoice_number` optionally suffixed with a tube letter (e.g. `2604160005`, `2604160005A`). Strip the trailing letters → `invoice_number`. An order is considered dispatched when the matching registration's tests are all dispatched. The simplest, accurate signal already used elsewhere in the project: the registration's `patient_results` rows for the order's tests have `status = 'dispatched'` (set by both the explicit Dispatch button and the WhatsApp send flow in `Dispatch.tsx` lines 288–310).

We compute this client-side in `LimsDemo.tsx` after fetching orders + matching registrations + their patient_results, and auto-cascade-delete via the existing `deleteOrder` mutation (which already cleans `lims_test_results` first, then the order).

## Implementation (one file: `src/pages/LimsDemo.tsx`)

### A. Auto-delete on dispatch
- After the `orders` query loads, derive base invoice numbers: `invoice = sample_id.replace(/[A-Za-z]+$/, "")`.
- Fetch matching `patient_registrations` (id, invoice_number, tests) for those invoice numbers.
- For each registration, fetch `patient_results (test_id, status)`. An order is "dispatched" when **every** test in the order's `tests` array has a corresponding `patient_results` row with `status = 'dispatched'` (cross-referenced by mapped param/test code → the already-resolved order test list).
- Pragmatic + safer rule: treat the order as dispatched when the registration has at least one `patient_results` row for it AND **all** rows for that registration are `status = 'dispatched'` (mirrors how the Dispatch screen treats a registration as fully sent). This avoids false positives from partial dispatches.
- A small `useEffect` runs after each refresh: for any order matching the rule, call `deleteOrder.mutate(order.id)` once. Realtime subscription on `patient_results` is added so this triggers immediately when Dispatch / WhatsApp marks results as dispatched.
- Subtle toast: "Auto-removed N dispatched orders" (only when N>0).

### B. Selection + bulk delete UI
- New state: `selectedOrderIds: Set<string>`.
- Add a checkbox column at the start of each Active Orders row + a "select all (filtered)" checkbox in the header strip.
- Header strip (above the list) shows: search input, count of selected, **Delete Selected** button (disabled when none), **Delete All (filtered)** button. Both run a confirm dialog (existing `AlertDialog` pattern in the project) before bulk-calling the existing `deleteOrder` mutation in a loop / `Promise.all`.

### C. Search bar
- New state: `orderSearch`.
- Client-side filter on the already-loaded `orders` array: case-insensitive match against `sample_id` or `patient_name`.
- All UI (count badge, select-all, bulk delete) operates on the filtered list.

## Out of scope
- No DB schema changes.
- No edge function changes.
- No change to how Dispatch / WhatsApp themselves work — we only react to the existing `status = 'dispatched'` writes.
- Logs, Code Mapping, and API tabs untouched.

## Files
- `src/pages/LimsDemo.tsx` — add search input, checkboxes, bulk-delete buttons, auto-cleanup effect, and a `patient_results` realtime channel (~80 lines added).
