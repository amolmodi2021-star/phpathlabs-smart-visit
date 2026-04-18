

## Goal
In LIMS → Registered Patients tab, replace the "20 registration(s) found" line with a date range filter (From / To) and load latest 50 by default.

## Changes — single file: `src/components/lims/RegisteredPatients.tsx`

1. **Remove count text**: Delete the `<div className="text-sm text-muted-foreground">{count} registration(s) found</div>` line.

2. **Add date range pickers** in the toolbar row (next to search):
   - Two `Popover + Calendar` shadcn date pickers (From, To) — same pattern used elsewhere in the codebase.
   - "Clear" button to reset both dates.
   - Default: both empty → show latest 50 (page 0 of paginated results, ordered by `created_at desc` as today).

3. **Wire dates into the query**:
   - Extend `useQuery` keys for both `patient_registrations_count` and `patient_registrations` to include `fromDate`, `toDate`.
   - Currently it uses RPC `get_all_patient_registrations` for export and direct table query for the list. The list query already paginates 20/page using `.range()`. Switch `PAGE_SIZE` from `20` → `50`.
   - Add `.gte("created_at", fromDateISO)` and `.lte("created_at", toDateEndOfDayISO)` to BOTH the count and list queries when set.
   - Reset `page` to 0 whenever dates or search change.

4. **Pagination footer**: Keep the existing Prev/Next that already shows "Page X of Y" — that replaces the removed count line cleanly.

## Out of scope
- No change to export, edit, view bill, clear-all-data, expanded row, or status logic.
- No DB migration (created_at on patient_registrations is already indexed via existing project indexes).
- Other tabs (Sample Collection, etc.) untouched.

## Expected outcome
- Default view: latest 50 registrations, no date filter, no count line.
- Selecting From/To filters server-side; pagination + search keep working in combination.
- Cleaner toolbar; faster default load.

