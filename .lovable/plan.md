

## Root cause

Middleware sends results with sample IDs **`2604170001-F`**, **`2604170001-P`**, **`2604170001-R`** (hyphen + tube-type letter suffix). The bridge code that writes results into `patient_results` (Results Entry) extracts the invoice number using:

```ts
const invoiceNumber = sample_id.replace(/[A-Za-z]+$/, "");
```

This regex only strips trailing **letters**, not the **hyphen**. So `"2604170001-F"` becomes `"2604170001-"` — which never matches the actual invoice `"2604170001"` in `patient_registrations.invoice_number`.

Result: `regRows` is empty → `registration` is `undefined` → entire bridge block silently skipped → `patient_results_written = 0`. The raw results land in `lims_test_results` (verified — PRM0025/PRM0026/PRM0027 are there) and `lims_test_orders` rows are marked `completed`, but Results Entry never sees them.

The base sample `2604170001` (no suffix) bridges fine, which is why some results from the same patient DID flow through (PRM0008, PRM0106, etc.) and others did not.

## Fix

**`supabase/functions/lims-interface/index.ts`** — change the suffix-stripping regex in **2 places** to also strip an optional leading hyphen:

```ts
const invoiceNumber = sample_id.replace(/-?[A-Za-z]+$/, "");
```

- Line 507 — POST results bridge (the actual bug causing user's issue)
- Line 68 — POST reprocess action (same pattern, same latent bug)

That's it. ~2 lines changed.

## After the fix — recovering already-failed results

The 3 failed results (PRM0025, PRM0026, PRM0027) are already stored in `lims_test_results` but never bridged. After deploying the fix, the user can recover them by triggering the existing **reprocess** action:

```
POST /lims-interface { action: "reprocess", registration_id: "<reg-id-for-2604170001>" }
```

Since the reprocess regex is also being fixed, it will now correctly resolve the registration for `2604170001-F/P/R` and push the missing rows into `patient_results`.

If there's no UI button to trigger reprocess for a single registration, I'll mention to the user how to invoke it (or we can add a one-click "Reprocess from interface" button later if needed — out of scope for this fix).

## Out of scope
- No DB changes.
- No changes to `query` (GET) path — it uses exact `eq("sample_id", ...)` so suffix is preserved correctly.
- No changes to the suffix scheme itself (`-F`, `-P`, `-R` stays as-is in barcodes/middleware).

## Files
- `supabase/functions/lims-interface/index.ts` — 2-character regex fix on lines 68 and 507.

