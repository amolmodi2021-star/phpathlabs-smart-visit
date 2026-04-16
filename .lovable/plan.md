

## Plan: Manually Add Code Mappings in LIMS Code Mapping Tab

### Goal
Add a UI to manually create entries in `lims_code_mapping` — letting the user type a Machine Code and pair it with a Parameter (from existing `report_test_parameters`), without waiting for an unmapped result to come in from the analyzer.

### Where
`src/pages/LimsDemo.tsx` → **Code Mapping tab**, new card placed **between** the "Unmapped Results" card and the existing "Code Mappings" table.

### New Card: "Add Mapping Manually"
A single inline row with three inputs + an Add button:

| Field | Control | Notes |
|---|---|---|
| Machine Code | `<Input>` | Free text (e.g. `WBC`, `RBC#`) — required |
| Machine ID | `<Input>` | Optional (e.g. `INDIKO`, `SYSMEX`) |
| Parameter | Searchable Popover (same component used in unmapped row) | Searches `allParams` by code/name — required |
| Action | `<Button>` Add | Disabled until Machine Code + Parameter are filled |

### Logic — new mutation `addMapping`
```ts
upsert({
  machine_code,
  machine_id: machineId || "",
  mapped_param_code: paramCode,
  parameter_name: param.parameter_name,
}, { onConflict: "machine_code,machine_id" })
```
- On success: toast "Mapping added", reset 3 fields, invalidate `lims-code-mappings` and `lims-unmapped` queries (so any matching unmapped rows will be hidden).
- On duplicate machine_code+machine_id: upsert quietly overwrites (same behavior as resolveUnmapped).

### State Additions
```ts
const [newMachineCode, setNewMachineCode] = useState("");
const [newMachineId, setNewMachineId] = useState("");
const [newParamCode, setNewParamCode] = useState("");
```

### File
- `src/pages/LimsDemo.tsx` — add state, add `addMapping` mutation, insert new Card in Code Mapping tab

### No DB / schema / other file changes

