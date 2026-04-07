

## Add Qualitative (Non-Numeric) Normal Range Support

### Problem
Some parameters like Urine Albumin, Widal Test, etc. have qualitative ranges (Absent/Present, Positive/Negative) rather than numeric low/high values. Currently the normal range form only has numeric Low/High fields plus a display text field, which doesn't properly capture expected qualitative values for flagging.

### Solution
Add a **"Range Type"** selector per parameter with two options:
1. **Numeric** (default) — shows Low/High number fields + display text (current behavior)
2. **Qualitative/Text** — shows a single "Expected Normal Value" text field (e.g., "Absent", "Negative", "Non-Reactive") + display text for report

This applies to each age/gender range row, so the same parameter could theoretically have text-based ranges.

### Implementation

#### Step 1 — Database Migration
- Add `range_type` column to `parameter_normal_ranges` table (text, default `'numeric'`, values: `'numeric'` or `'qualitative'`)
- Add `expected_value` column to `parameter_normal_ranges` (text, nullable) — stores the normal qualitative value (e.g., "Absent", "Negative")

#### Step 2 — UI Changes in ReportParameters.tsx
- Add a toggle or select per range row: "Numeric" vs "Qualitative"
- When **Numeric**: show Low, High, Display Text (current behavior)
- When **Qualitative**: hide Low/High, show "Expected Normal Value" input (e.g., "Absent") + Display Text
- Update the `NormalRange` interface, save logic, and edit-load logic to handle the new fields

#### Step 3 — Flagging Integration (future-ready)
- The existing qualitative flagging engine in `reportFlags.ts` already detects abnormalities by comparing result text against expected values like "Absent"/"Negative"
- The `expected_value` field will feed directly into this engine when results are entered

### Files to Modify
- `supabase/migrations/` — new migration adding `range_type` and `expected_value` columns
- `src/pages/ReportParameters.tsx` — UI changes for range type toggle and conditional fields

