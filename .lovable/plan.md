

# LIMS Bidirectional Interface — Machine ID Filtering & Result Mapping

## Overview
Three changes needed: (1) accept `machine_id` in query requests and filter tests accordingly, (2) map incoming result test codes to actual parameters when results are submitted, (3) add a new UI section for managing unmapped test codes.

---

## 1. Edge Function: Accept & filter by `machine_id` in queries

**File:** `supabase/functions/lims-interface/index.ts`

**GET handler changes:**
- Read `machine_id` from query params: `url.searchParams.get("machine_id")`
- Include `machine_id` in the logged `request_body`
- After building the `pendingTests` list and enriching with `machineMap`, filter tests to only those matching the requested `machine_id` (if provided)
- If no tests match the machine, return empty array with a message like "No tests for this machine"

**POST handler changes (result mapping):**
- When results come in, look up each `test_code` in a new `lims_code_mapping` table to find the mapped `param_code`
- If a mapping exists, use the mapped code to match against the order's tests and to insert into `lims_test_results`
- If no mapping exists, insert the result with a flag `is_mapped: false` so it appears in the unmapped section
- Store unmapped codes in a new `lims_unmapped_results` table for the UI to display

---

## 2. Database: New tables

**Migration 1 — `lims_code_mapping`:**
```sql
CREATE TABLE public.lims_code_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code text NOT NULL,
  machine_id text DEFAULT '',
  mapped_param_code text DEFAULT '',
  mapped_test_code text DEFAULT '',
  parameter_name text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(machine_code, machine_id)
);
ALTER TABLE public.lims_code_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON public.lims_code_mapping FOR ALL USING (true) WITH CHECK (true);
```

**Migration 2 — `lims_unmapped_results`:**
```sql
CREATE TABLE public.lims_unmapped_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id text NOT NULL,
  order_id uuid REFERENCES lims_test_orders(id) ON DELETE CASCADE,
  machine_code text NOT NULL,
  machine_id text DEFAULT '',
  result_value text DEFAULT '',
  unit text DEFAULT '',
  reference_range text DEFAULT '',
  flag text DEFAULT 'Normal',
  received_at timestamptz DEFAULT now(),
  is_resolved boolean DEFAULT false
);
ALTER TABLE public.lims_unmapped_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON public.lims_unmapped_results FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_unmapped_results;
```

**Migration 3 — Add `machine_id` column to `lims_interface_logs`:**
```sql
ALTER TABLE public.lims_interface_logs ADD COLUMN IF NOT EXISTS machine_id text DEFAULT '';
```

---

## 3. Edge Function: Updated result submission logic

**POST handler in `lims-interface/index.ts`:**
- For each result received, check `lims_code_mapping` for `machine_code = result.code`
- If mapped → insert into `lims_test_results` with the mapped code, mark order test as completed
- If unmapped → insert into `lims_unmapped_results` instead
- Response includes counts: `{ mapped: N, unmapped: M }`

---

## 4. UI: New "Unmapped Results" tab in LimsDemo.tsx

**File:** `src/pages/LimsDemo.tsx`

Add a 4th tab: **"Code Mapping"** with two sections:

### Section A — Unmapped Results
- Query `lims_unmapped_results` where `is_resolved = false`
- Table showing: Sample ID, Machine Code, Machine ID, Result Value, Unit, Flag, Received At
- Each row has a "Map" button that opens an inline form to assign a `param_code` from `report_test_parameters`
- On mapping: insert into `lims_code_mapping`, move the result to `lims_test_results` with the mapped code, mark `is_resolved = true`

### Section B — Code Mappings
- Table of all entries in `lims_code_mapping`
- Shows: Machine Code → Mapped Param Code / Parameter Name, Machine ID
- Delete button to remove mappings
- Realtime subscription on `lims_unmapped_results` for live updates

---

## 5. Interface Logs enhancement

- Log `machine_id` in the new column on `lims_interface_logs`
- Display machine_id badge in the logs tab UI next to sample_id

---

## 6. API Reference update

Update the API Reference tab to show the new `machine_id` query parameter:
```
GET ...?action=query&sample_id=BARCODE123&machine_id=MACH001
```

---

## Files to modify
1. `supabase/functions/lims-interface/index.ts` — machine_id filtering + result mapping logic
2. `src/pages/LimsDemo.tsx` — new Code Mapping tab, logs machine_id display, API docs update
3. Database migrations — 3 new tables/columns

