

## Add Sample ID Suffix for Parameters

### Problem
When two parameters (e.g., FBS and PPBS) are registered together for the same patient, they share the same barcode/sample ID. The machine cannot distinguish between fasting and post-prandial samples, causing incorrect result mapping.

### Solution
Add a toggle + suffix field to parameters so each parameter can specify a custom sample ID suffix (e.g., `-F`, `-P`). During barcode generation and LIMS interfacing, the suffix is appended to the base invoice number to create unique sample IDs per parameter.

### Database Change
- **Migration**: Add two columns to `report_test_parameters`:
  - `custom_sample_suffix_enabled` (boolean, default `false`)
  - `custom_sample_suffix` (text, nullable)

### UI Change — `src/pages/ReportParameters.tsx`
- Add to the form state: `custom_sample_suffix_enabled` and `custom_sample_suffix`
- In the parameter edit dialog (near the Machine/Interface section), add:
  - Toggle: "Custom Sample ID Suffix"
  - When ON: show a text input for the suffix value (e.g., `-F`, `-P`)
- Save/load these fields in `handleSave`, `handleEdit`, and `openNew`

### LIMS Interface Impact (future-ready)
- The `custom_sample_suffix` value will be used later when:
  1. Generating barcodes — append suffix to invoice number per parameter
  2. Sending orders via LIMS interface — use suffixed sample IDs
  3. Receiving results — match results using suffixed sample IDs

### Files to Modify
- `supabase/migrations/` — new migration for the two columns
- `src/pages/ReportParameters.tsx` — form state, dialog UI, save/load logic

