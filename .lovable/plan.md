

## Plan: Corrections Feedback Loop

### Concept
When a user edits extracted data in the Review screen and saves, compare the AI-extracted values against the user-corrected values. Store the differences in a new `extraction_corrections` table. Then, when the extract-report edge function runs, fetch recent corrections and inject them as few-shot examples into the system prompt so the AI learns from past mistakes.

### Database Change
New table `extraction_corrections`:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| parameter_name | text | The parameter that was corrected |
| field_corrected | text | Which field: result_value, normal_range_low, normal_range_high, normal_range_text, unit, flag |
| original_value | text | What AI extracted |
| corrected_value | text | What user changed it to |
| created_at | timestamptz | Auto |

RLS: permissive (matches existing pattern).

### Code Changes

**1. `src/pages/ReviewReport.tsx` — Log corrections on save**

In `handleSaveAndGenerate`, before saving, compare `testResults` (user-edited) against the originally loaded `extractedData.test_results` (AI-extracted). For each parameter where `result_value`, `unit`, `normal_range_low`, `normal_range_high`, `normal_range_text`, or `flag` differs, insert a row into `extraction_corrections`. Store the original AI results in a `useRef` at load time so edits don't overwrite them.

**2. `supabase/functions/extract-report/index.ts` — Inject corrections into prompt**

Before calling the AI gateway, query `extraction_corrections` for the most recent ~50 corrections (deduplicated by parameter_name + field_corrected, keeping latest). Append them to the system prompt as a "LEARNED CORRECTIONS" section:

```text
LEARNED CORRECTIONS (from past user fixes — apply these patterns):
- Parameter "Abs Monocytes": normal_range_low should be "200" not "2000"
- Parameter "HDL Cholesterol": normal_range_text should include full advisory range
...
```

This gives the AI concrete examples of its past mistakes without any model retraining.

### Files Modified
1. **Database migration** — create `extraction_corrections` table
2. **`src/pages/ReviewReport.tsx`** — store original results in ref, diff on save, insert corrections
3. **`supabase/functions/extract-report/index.ts`** — fetch corrections from DB, append to system prompt

