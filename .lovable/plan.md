

## Robust Test-Parameter Architecture for Bi-Directional Interface

### The Problem

Currently there are two separate systems:
1. **`tests` table** — billing/registration tests (HBA1C, CBC, etc.) with test codes (TST0001)
2. **`report_test_parameters` table** — report parameters (Glycated Hb, eAG, Hemoglobin, etc.) used for report generation

These are disconnected. You need a unified structure where:
- Each test (e.g., HBA1C) has child parameters (Glycated Hb, eAG)
- Each parameter has its own code for machine mapping (bi-directional interface)
- Each parameter has normal ranges (age/gender-specific later)
- Parameters can be shared across tests (e.g., "Hemoglobin" in CBC and Anemia Profile)

### Proposed Architecture

```text
┌──────────────────────┐
│       tests          │  (existing — billing test, TST0001)
│  id, test_name,      │
│  test_code, price... │
└──────┬───────────────┘
       │ 1:N
┌──────┴───────────────┐
│  test_parameters     │  (NEW junction table)
│  test_id  ──→ tests  │
│  parameter_id ──→    │
│    report_test_params │
│  display_order       │
│  param_code (auto)   │  ← PRM0001, PRM0002 (for machine mapping)
└──────┬───────────────┘
       │ N:1
┌──────┴───────────────┐
│ report_test_parameters│ (existing — the actual parameter)
│  parameter_name,     │
│  unit, normal ranges,│
│  sample_type, method │
└──────────────────────┘
```

### What This Solves

1. **Shared parameters**: Hemoglobin can belong to CBC, Anemia Profile, and HBA1C simultaneously via the junction table
2. **Machine codes**: Each parameter gets an auto-generated `param_code` (PRM0001) for instrument mapping; the test already has `test_code` (TST0001)
3. **Normal ranges**: Already on `report_test_parameters` (normal_range_low, normal_range_high, normal_range_text) — can be extended for age/gender later
4. **Single source of truth**: No duplicate parameter definitions

### Implementation Steps

#### Step 1 — Database Migration
- Create `test_parameters` junction table linking `tests.id` → `report_test_parameters.id`
- Add `param_code` column to `report_test_parameters` with auto-sequence (PRM0001, PRM0002...)
- Backfill param codes for all 159 existing parameters
- Create trigger for auto-assigning param codes on new parameters

#### Step 2 — Test Management UI Enhancement
- Add a "Parameters" section inside each test's edit dialog (or an expandable row)
- Show linked parameters with their codes, units, and normal ranges
- Allow adding existing parameters (search/select from master) or creating new ones inline
- Allow setting display order of parameters within a test
- For "Single Parameter" tests, auto-link the single parameter

#### Step 3 — Parameter Management Updates
- Show `param_code` (read-only) in the Report Parameters page
- Add normal range fields if not already visible (low, high, text)
- Show which tests use each parameter (reverse lookup)

#### Step 4 — Bi-Directional Interface Integration
- Update the LIMS interface edge function to use `test_code` + `param_code` for order/result mapping
- When sending orders to machine: send test_code with child param_codes
- When receiving results from machine: match by param_code to populate results

### Technical Details

**New table: `test_parameters`**
```sql
CREATE TABLE public.test_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES report_test_parameters(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(test_id, parameter_id)
);

-- Add param_code to existing parameters table
CREATE SEQUENCE IF NOT EXISTS param_code_seq START 1;
ALTER TABLE report_test_parameters ADD COLUMN IF NOT EXISTS param_code text;

-- Auto-assign trigger (similar to test_code)
CREATE OR REPLACE FUNCTION auto_assign_param_code() ...
-- Backfill: UPDATE report_test_parameters SET param_code = 'PRM' || lpad(...)
```

**UI in TestManagement.tsx**
- Each test row gets an expandable section or a "Manage Parameters" button
- Opens a panel showing linked parameters with code, unit, normal range
- Search-and-add from the existing `report_test_parameters` master list
- "Create New Parameter" button for parameters not yet in master data

**Files to modify:**
- `supabase/migrations/` — new migration for junction table + param codes
- `src/pages/TestManagement.tsx` — add parameter management UI within test edit
- `src/pages/ReportParameters.tsx` — show param_code column
- `src/lib/tests.ts` — add functions for test-parameter CRUD
- `supabase/functions/lims-interface/index.ts` — use param_codes for mapping

