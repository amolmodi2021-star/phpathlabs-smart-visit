## Goal

In **Test Management → Departments**, expand each department row to show all tests assigned to it, and let the user reorder those tests via drag-and-drop. The chosen order replaces the current alphabetical sort when reports are generated.

## What the user will see

Departments tab keeps the existing draggable list of departments. Each row becomes expandable (chevron). Expanded panel shows:

```text
▾ BIOCHEMISTRY                                        Order: 2  [Edit] [Del]
   ┌─────────────────────────────────────────────────────────────┐
   │ ⋮⋮  LFT (Liver Function Test)                       #1      │
   │ ⋮⋮  KFT / RFT (Renal Function Test)                 #2      │
   │ ⋮⋮  LIPID PROFILE                                   #3      │
   │ ⋮⋮  HBA1C                                           #4      │
   └─────────────────────────────────────────────────────────────┘
   (Drag the handle to change the order tests appear in reports)
```

Empty departments show "No tests assigned to this department".

## How it works

1. Add a new column `report_display_order` (integer, nullable) to the `tests` table. Existing tests get backfilled by alphabetical order within each department so behaviour is unchanged at first load.
2. The department row in `ReportDepartments.tsx` becomes a collapsible. On expand, fetch the tests where `department_id = <dept.id>` ordered by `report_display_order NULLS LAST, test_name`.
3. Inside the panel, render a `DndContext` + `SortableContext` of test rows (handle, name, position number). On drag-end, reassign `report_display_order = index + 1` for the affected department's tests and persist via a single batched update.
4. In **`src/pages/LimsReportView.tsx`** change the test sort (currently `a.testName.localeCompare(b.testName)`) to use `report_display_order` first, falling back to test name. The tests `select(...)` query is extended to include `report_display_order`. Department-level order remains unchanged.

## Technical notes

- **Migration**: `ALTER TABLE tests ADD COLUMN report_display_order integer;` then a backfill `UPDATE` using `ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY test_name)`. Add an index on `(department_id, report_display_order)` for fast ordered fetches.
- **Files touched**
  - `src/pages/ReportDepartments.tsx` — add expand/collapse state per dept, nested sortable test list, save handler.
  - `src/lib/tests.ts` — add `getTestsByDepartment(deptId)` and `reorderTestsInDepartment(items)` helpers (mirroring the existing `reorderTestParameters` pattern).
  - `src/pages/LimsReportView.tsx` — add `report_display_order` to the tests select; build `testOrderMap`; replace alphabetical fallback with `(orderMap[a.testId] ?? 9999) - (orderMap[b.testId] ?? 9999)` then name.
  - `src/lib/expandRegistrationTests.ts` — verify it does not assume alphabetical order (read-only check; no change expected).
- **Drag library**: reuse `@dnd-kit/core` + `@dnd-kit/sortable` already used by `SortableRow` in `ReportDepartments.tsx` and by `TestParameterManager.tsx`.
- **Persistence pattern**: same as `reorderTestParameters` — issue per-row `UPDATE` calls in `Promise.all`, then toast "Order updated".
- **No impact on**: billing order, results entry grouping (already grouped by machine/instrument), or department ordering itself.

## Out of scope

- Changing how tests are assigned to a department (still done via the test edit form's Department dropdown).
- Reordering parameters inside a test (already handled in `TestParameterManager`).
- Cross-department drag (a test belongs to exactly one department).
