
## Goal
Remove the **Machine ID** field from the "Add Mapping Manually" form and the **Machine ID** column from the "Code Mappings" table on `/lims-demo` (Code Mapping tab). The DB column stays (mapping is already matched by `machine_code` only); we just hide it from the UI.

## Changes — `src/pages/LimsDemo.tsx`
1. **Add Mapping Manually form**: remove the Machine ID input. In the `addMapping.mutationFn`, insert with `machine_id: ''` (consistent with how the No Map Required entries are stored).
2. **Code Mappings table**: remove the "Machine ID" `<TableHead>` and the matching `<TableCell>` from each row. Adjust `colSpan` on the empty-state row accordingly.
3. **Edit Mapping dialog**: also drop the Machine ID field — it serves no purpose if it's not shown in the table and isn't used in matching. `updateMapping` keeps `machine_id` untouched (don't overwrite existing values).

## Out of scope
- No DB migration — `machine_id` column remains on `lims_code_mapping` for backward compatibility.
- Edge function — already matches purely by `machine_code`, no change needed.
- "No Map Required" section — keeps its Machine ID column as-is (separate request).
- Unmapped Results section — unchanged.

## Files
- `src/pages/LimsDemo.tsx` — remove one input, one table column, one dialog field, adjust `colSpan`.
