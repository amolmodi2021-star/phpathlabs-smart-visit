## Problem

For invoice `2605010004` (MONIKA GUPTA, TFT), all three parameters (T3, T4, TSH) are saved with `status='entered'` and the registration's `status='processed'`. The card now correctly appears in the **Result Verification** tab, but it is **also still visible** in the **Result Entry** tab.

## Root Cause

`src/components/lims/ResultsEntry.tsx` does have two layers of filtering:
- Line 622-625: skip a test if every param has `existing.status === 'entered'`.
- Line 1060-1072: per-param filter on `entered`/`verified`/`approved`/`dispatched`, then drop entries with nothing left.

But the registration-level fetch at lines 188 / 203 still pulls in `processed`, `partial_verified`, `verified`, `approved`, `dispatched` statuses — so the row enters the in-memory pipeline and any tiny mismatch (param-id lookup miss, stale React Query cache, partial realtime echo) leaves the patient card visible. The `count` query at line 184 also uses the same broad filter, so even when the card is filtered client-side, the header count still ticks up.

We need a **single, authoritative server-side guard** that prevents a "fully entered" registration from being fetched into the Results Entry queue at all — the client-side skip logic stays as a safety net.

## Plan

### 1. Tighten the Results Entry registration list (server-side)

In `src/components/lims/ResultsEntry.tsx`:
- Change the `.in("status", [...])` filter on **both** the `results_accepted_regs` query (line 203) and the `results_accepted_count` query (line 188) to only include statuses where work is genuinely pending:
  - Keep: `sample_accepted`, `partially_accepted`, `processing`, `partial_processing`.
  - **Remove**: `processed`, `partial_verified`, `verified`, `partially_approved`, `approved`, `partially_dispatched`, `dispatched`.
- Effect: a registration whose every parameter is `entered`/`verified`/`approved`/`dispatched` (i.e. `recalculateRegistrationStatus` flipped it to `processed` or beyond) is no longer fetched on the Results Entry tab.

This matches how `ResultVerification.tsx` already filters — that tab uses `processing`, `partial_processing`, `processed`, `partial_verified`, `verified`, … — so the registration is the verification queue's responsibility once entry is complete.

### 2. Keep the safety-net client filter

Lines 622-625 and 1060-1072 stay as defence-in-depth in case a single param row is somehow still `pending` while the rest are `entered` (the registration would then re-appear via `partial_processing`, and the per-param filter still drops the entered ones — exactly the desired behaviour).

### 3. Stabilise invoice 2605010004

- The DB already has all three params as `status='entered'` and registration `status='processed'`. After step 1 ships, the row will disappear from Results Entry on the next refetch and continue to be visible in Verification — no manual data fix needed.
- Re-run `recalculateRegistrationStatus('95c87cdd-412c-4e19-9a94-4c1b50894f1b')` once via a one-shot migration just to be sure the `status` column reflects the live `patient_results` state (defensive — current state is already `processed`).

### 4. Verify

- Reload `/lims?tab=results`; invoice `2605010004` must no longer appear.
- Reload `/lims?tab=verification`; invoice `2605010004` must remain visible with three `entered` params ready to verify.
- Verify a fresh registration end-to-end: enter all params on a TFT → click "Save & Verify" → card vanishes from Results Entry, appears in Verification.

## Files to change

- `src/components/lims/ResultsEntry.tsx` — narrow status filters on the two queries (lines 188 and 203).
- `supabase/migrations/<new>.sql` — one-shot `update patient_registrations set updated_at = now() where id = '95c87cdd-412c-4e19-9a94-4c1b50894f1b'` to nudge the realtime broadcast (status is already correct).

No schema changes; no other modules affected (Verification, Doctor Approval, Dispatch already use their own status filters).
