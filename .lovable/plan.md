

## Add Edit Mapping with Searchable Parameter Selector

### What changes
In the "Existing Mappings" table (`src/pages/LimsDemo.tsx`), add an Edit button next to each mapping's Delete button. Clicking Edit makes the "→ Param Code" and "Parameter Name" cells become an inline searchable Popover+Command selector (same pattern already used for unmapped results). A Save button confirms the update.

### Implementation

**File:** `src/pages/LimsDemo.tsx`

1. **Add state** for tracking which mapping is being edited and the selected new param code:
   - `editingMappingId: string | null`
   - `editingParamCode: Record<string, string>`

2. **Add an `updateMapping` mutation** that updates `lims_code_mapping` with the new `mapped_param_code` and `parameter_name` by ID, then invalidates the query.

3. **Update the mappings table row** (lines 570-583):
   - When `editingMappingId === m.id`, replace the Param Code + Parameter Name cells with the same Popover+Command searchable selector used for unmapped results
   - Show Save (check icon) and Cancel (X icon) buttons instead of Edit/Delete
   - When not editing, show the current values plus an Edit (Pencil) button alongside the existing Delete button

4. **Import** `Pencil` icon from lucide-react (already have `Check`, `Trash2`, etc.)

### No database or edge function changes needed — just a client-side update to an existing row.

