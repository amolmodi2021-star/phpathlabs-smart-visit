## Root cause analysis for invoice 2605010004 (MONIKA GUPTA)

I checked the live DB. The registration has exactly 1 test (TSH) with this state:

| Field | Value |
|---|---|
| `patient_results.status` | `entered` |
| `patient_results.verified_at` | NULL |
| `patient_results.verified_by` | NULL |
| `patient_registrations.status` | `processed` |
| `sample_tubes.status` | `accepted` |

**The DB has no record of a Verify action ever happening for this registration.** Only "Save & Send to Verification" (which writes status=`entered`) has touched the row. So either:

1. The Verify click in `ResultVerification.tsx` silently failed (toast not seen / hidden behind another dialog), OR
2. The user clicked Verify in a stale tab whose `verifyTest` state had no parameters, so the underlying `delete + insert` was a no-op, OR
3. The user only opened Verification but didn't actually press Verify (less likely given their certainty).

In ALL three cases the current code is fragile. Specifically `verifyTest` (lines 661-702) and `verifyAllForPatient` (706-742) in `ResultVerification.tsx` have these weaknesses:

**Bug A — Silent no-op on stale params.** If `entry.parameters.filter(p => p.testId === testId)` returns an empty array (e.g. cached entry built before sample-tube/test_parameters loaded, or a race during refetch), `upserts.length === 0` so the `if (upserts.length > 0)` block is skipped entirely, but the function still proceeds to `propagateRegistrationChange` and shows a green success toast. The DB is never touched. The reg stays at status=`processed` and reappears in both queues forever.

**Bug B — Wrong status filter on delete.** `delete().eq("status", "entered")` only removes rows that are exactly `entered`. If the source row was `pending` (Save Later) or `results_entered` from an interface push, the delete matches nothing, then the insert creates a DUPLICATE row (no unique constraint exists on `patient_results(registration_id, test_id, parameter_id)` — verified). The recalculated status then becomes `partial_verified`, and the registration sticks around in Results Entry forever.

**Bug C — No DB error surfacing.** The `insert` and `update` calls don't capture `{ error }`. If the insert fails (RLS/network/duplicate trigger) the function still proceeds to propagate and toast success.

**Bug D — Re-entry shows registrations that are stuck.** Result Verification queue's status filter accepts `processed`, which is correct. But there's no way for an operator to see "this reg is stuck — its DB row is `entered` but somebody clicked Verify". That's why the user's confusion compounds.

## Fix plan

### 1. Make `verifyTest` and `verifyAllForPatient` in `src/components/lims/ResultVerification.tsx` correct & loud

For each test being verified:

a. **Refetch the live `patient_results` rows for `(registration_id, test_id)` from DB** instead of trusting stale React state. Build the upsert list from the DB rows merged with `editedValues`/`editedFlags`/etc. This eliminates Bug A.

b. **Broaden the delete filter**: `.in("status", ["pending", "entered", "results_entered"])` so any prior-state row is removed atomically with the verified insert. Eliminates Bug B.

c. **Capture and throw on every `error`** from `supabase.from(...).insert/update/delete`. If any step errors, surface a toast and abort. Eliminates Bug C.

d. **Verify the post-condition**: after insert, re-query `patient_results` to confirm at least one row with `status='verified'` and matching `verified_at` exists for `(reg.id, test_id)`. If not, throw. This is a defence-in-depth check that takes ~1 query and prevents silent failure forever.

e. **Add a unique index** on `patient_results (registration_id, test_id, parameter_id)` via migration so duplicates can never accumulate going forward. This requires a one-time cleanup migration first to delete duplicate rows (keep the newest per key).

### 2. Self-heal for invoice 2605010004 right now

Apply a one-off SQL migration that flips this single row to `verified` with proper timestamps, then runs `recalculateRegistrationStatus` so the row leaves the Results queue and proceeds to Doctor Approval. Tag `verified_by = 'system-recovery'` for audit clarity.

### 3. Add a "Stuck registrations" diagnostic in Result Verification

A small admin-only banner (password-gated, like other LIMS tools) that lists registrations whose `patient_registrations.status` is `processed` / `partial_processing` and whose oldest `patient_results.entered_at` is older than 6 hours. This makes future stuck rows visible and gives a one-click "force re-verify" / "force recalculate status" action.

## Files touched

- `src/components/lims/ResultVerification.tsx` — rewrite `verifyTest` & `verifyAllForPatient` per points 1a–1e.
- New migration: backfill row for reg `95c87cdd-412c-4e19-9a94-4c1b50894f1b`, dedupe `patient_results`, add unique index.
- `src/components/lims/ResultVerification.tsx` (or a small new sub-component) — the stuck-registrations banner.

## Out of scope (not changing)

- Realtime/cost optimisations done earlier today stay as-is. The fix above does not re-introduce ambient subscriptions; the post-write self-check in 1d is per-action only.
- ResultsEntry queue logic is correct — once a row is properly `verified`, it disappears from Results as expected.

Approve and I'll implement.
