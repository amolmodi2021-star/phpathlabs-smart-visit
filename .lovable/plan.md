# Add Financial + Created By Columns to Registered Patients Table

## What changes

In **LIMS → Registered Patients**, replace the single "Amount" column with six dedicated, right-aligned numeric columns and add a **Created By** column showing the user who registered the patient.

New columns:
1. **Gross Amount (Tests)** — `gross_amount` (sum of test prices before discount, excludes home visit charges)
2. **Discount Amount** — `discount_amount`
3. **Net Amount** — `net_amount` (gross − discount)
4. **Home Visit Charge** — `home_visit_charges` (₹0 for non-home-visit registrations)
5. **Paid Amount** — `paid_amount`
6. **Due Amount** — `due_amount` (highlighted red when > 0)
7. **Created By** — `registered_by` (user's display name; falls back to "—" for older rows where it wasn't captured)

The existing **Refund** indicator (when `refund_amount > 0`) will be shown as a small caption under the Paid Amount cell so refund visibility is preserved.

## Layout

The table will get wider. To keep it readable on the current 1843px viewport:
- All six numeric columns use `text-right`, tabular numerals, and a compact `text-xs` font.
- Wrap the table in a horizontally scrollable container (`overflow-x-auto`) so it remains usable on smaller screens.
- Created By placed between Remarks and the financial columns.
- The chevron, Invoice #, Date, Patient, Mobile, Visit, Channel, Remarks, Status, and Actions columns remain unchanged.

New header order (left → right):

```text
[▸] Invoice # | Date | Patient | Mobile | Visit | Channel | Remarks | Created By |
Gross | Discount | Net | HV Charge | Paid | Due | Status | Actions
```

## Technical details

File: `src/components/lims/RegisteredPatients.tsx`

- Replace the single `<TableHead className="text-right">Amount</TableHead>` with six right-aligned heads (Gross, Discount, Net, HV Charge, Paid, Due).
- Add a `<TableHead>Created By</TableHead>` after Remarks.
- Replace the corresponding `<TableCell>` (currently rendering `final_amount` + due/refund captions) with six cells reading from the existing row fields already returned by the `patient_registrations` query — no schema or query changes needed.
- Add a `<TableCell className="text-xs">{r.registered_by || "—"}</TableCell>` for Created By.
- Update `colCount` from `10` to `16` so the empty-state, loading, and expanded-detail rows continue to span the full width correctly.
- Format all amounts as `₹{Number(value || 0).toFixed(2)}` for consistency.
- Highlight `Due Amount` cell text in `text-destructive` when `due_amount > 0`.
- Show small `Refund: ₹X` caption under Paid cell when `refund_amount > 0` (preserves existing info).
- Add **"Created By"** column to the Excel export (`handleExport`) reading `r.registered_by`.
- Keep the row's red STAT highlight, cancelled-bill opacity, and click-to-expand behaviour intact.

No database migration required — `registered_by` and all six financial fields already exist on `patient_registrations`. Newer registrations stamp `registered_by` automatically (PatientRegistration, CompletedHomeVisits, EditAndRegisterHomeVisitDialog); historical rows without a value will show "—".

## Out of scope

- Backfilling `registered_by` for legacy registrations.
- No changes to Edit dialog, Invoice preview, or other LIMS tabs.
