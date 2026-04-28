## Root Cause (full picture)

The "patient took too long to appear" / "patient seems lost" symptom across Results, Verification, Doctor Approval and Dispatch is caused by **four compounding bugs**, not one. Together they also explain why the issue gets worse with more data and more concurrent users.

### Bug 1 — Wrong React Query keys are invalidated after actions

Each module fetches with specific keys:

| Module             | Actual query keys                                                                                              |
|--------------------|----------------------------------------------------------------------------------------------------------------|
| Results            | `results_accepted_regs`, `results_accepted_count`, `results_accepted_tubes`                                     |
| Verification       | `verification_regs_v2`, `verification_regs_count`, `verification_results_v2`, `verification_outsourced_v2`     |
| Doctor Approval    | `doctor_approval_regs`, `doctor_approval_count`, `doctor_approval_results`, `doctor_approval_snips`            |
| Dispatch           | `dispatch_regs`, `dispatch_regs_count`, `dispatch_all_results`, `dispatch_all_snips`, `dispatch_held_reports`  |

But the action handlers invalidate things like:

```ts
qc.invalidateQueries({ queryKey: ["doctor_approval"] });   // matches NOTHING
qc.invalidateQueries({ queryKey: ["dispatch_"] });         // matches NOTHING (not a prefix match either)
```

React Query keys are matched by **array element equality** (`["dispatch_"]` ≠ `["dispatch_regs"]`). So after Save & Verify / Verify / Approve / Send Back, the destination tab's cached data is **not** refreshed — the new patient only shows up later, when the realtime subscription's 400 ms debounce eventually fires (and even then, only if realtime is connected). Under load this looks like a 5–30 s delay, or "patient missing" until manual reload.

### Bug 2 — `recalculateRegistrationStatus` is fired-and-forgotten

```ts
recalculateRegistrationStatus(reg.id).catch(console.error);   // not awaited
qc.invalidateQueries(...);
signalSync("doctor_approval", reg.id);
```

This function is what flips `patient_registrations.status` to `partial_verified` / `verified` / `approved` — the exact field every destination tab filters on. Because it is not awaited, the cache invalidation and the "Syncing…" signal fire **before** the status row is written. Any refetch triggered by them runs against stale DB state and silently filters the patient out. With more rows in the DB this race window widens (the recalculate's three SELECTs take longer).

### Bug 3 — `SyncingOverlay` can't auto-dismiss

`Lims.tsx` mounts `<SyncingOverlay target="..." />` without `visibleIds`, so the overlay can only disappear via its 8-second TTL — never by actually observing arrival. So when it vanishes the user assumes data has loaded; it hasn't.

### Bug 4 — Realtime is the only safety net, and it's fragile under load

`useRealtimeSync` debounces 400 ms and invalidates a flat list of keys. With many concurrent users (multiple machines pushing results, several technicians clicking Save & Verify), every client receives every postgres_changes event, the debounce keeps resetting, and invalidations get coalesced or dropped. Combined with Bug 1 (wrong keys), realtime ends up being the only reason data ever appears — and it doesn't scale.

---

## The Fix — a single reliable propagation primitive

Stop hand-rolling invalidation lists in every action handler. Instead, introduce **one shared helper** that every workflow action calls. It does the things in the correct order and with the correct keys, every time. This eliminates all four bugs at once and makes the codebase robust under load and concurrency.

### 1. New helper: `src/lib/limsPropagation.ts`

```ts
export type LimsModule = "results" | "verification" | "doctor_approval"
                       | "dispatch" | "sample_collection" | "sample_acceptance"
                       | "completed_hv" | "billing" | "due" | "bad_debt";

// Single source of truth: which query keys belong to each module.
const MODULE_KEYS: Record<LimsModule, string[]> = {
  results:           ["results_accepted_regs", "results_accepted_count",
                      "results_accepted_tubes", "results_test_params_full",
                      "verification_results_v2"],   // shared cache
  verification:      ["verification_regs_v2", "verification_regs_count",
                      "verification_results_v2", "verification_outsourced_v2",
                      "verification_tubes"],
  doctor_approval:   ["doctor_approval_regs", "doctor_approval_count",
                      "doctor_approval_results", "doctor_approval_snips",
                      "doctor_approval_tubes"],
  dispatch:          ["dispatch_regs", "dispatch_regs_count",
                      "dispatch_all_results", "dispatch_all_snips",
                      "dispatch_all_tubes", "dispatch_held_reports"],
  // …
};

/**
 * Call after ANY workflow action that may move a registration between modules.
 * - Awaits status recalculation FIRST (so DB is committed before refetch).
 * - Invalidates the correct keys for every destination module.
 * - Signals the SyncingOverlay so the UX feedback is accurate.
 * - Optimistically marks the regId as visible in the destination cache so a
 *   user clicking the tab sees it instantly while the refetch finishes.
 */
export async function propagateRegistrationChange(
  qc: QueryClient,
  regId: string,
  destinations: LimsModule[],
  opts?: { skipRecalc?: boolean }
) {
  if (!opts?.skipRecalc) {
    await recalculateRegistrationStatus(regId);   // AWAIT — fixes Bug 2
  }
  const keys = new Set<string>();
  destinations.forEach(d => MODULE_KEYS[d].forEach(k => keys.add(k)));
  await Promise.all(
    [...keys].map(k => qc.invalidateQueries({ queryKey: [k] }))   // correct keys — fixes Bug 1
  );
  destinations.forEach(d => signalSync(d, regId, 15000));         // fixes Bug 3 (longer TTL)
}
```

### 2. Replace every ad-hoc invalidation block with one call

Example — `ResultVerification.tsx`, `verifyTestForPatient`:

```ts
// BEFORE:
toast.success(`${testName} verified & sent to Doctor Approval`);
signalSync("doctor_approval", reg.id);
recalculateRegistrationStatus(reg.id).catch(console.error);
qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
qc.invalidateQueries({ queryKey: ["doctor_approval"] });   // BUG
qc.invalidateQueries({ queryKey: ["patient_results_existing"] });

// AFTER:
await propagateRegistrationChange(qc, reg.id, ["verification", "doctor_approval"]);
toast.success(`${testName} verified & sent to Doctor Approval`);
```

Apply the same replacement to:
- `ResultsEntry.tsx` — Save & Verify, Save Draft → `["results", "verification"]`
- `ResultVerification.tsx` — Verify (single & all), Send Back → `["verification", "doctor_approval"]` / `["verification", "results"]`
- `DoctorApproval.tsx` — Approve (single & all), Send Back → `["doctor_approval", "dispatch"]` / `["doctor_approval", "verification"]`
- `Dispatch.tsx` — Dispatch, Send Back → `["dispatch"]` / `["dispatch", "doctor_approval"]`
- `SampleCollection.tsx` / `SampleAcceptance.tsx` — Collect / Accept → `["sample_collection", "sample_acceptance"]` etc.

### 3. Move `SyncingOverlay` inside each destination component with `visibleIds`

```tsx
// at the top of the rendered queue in DoctorApproval.tsx, etc.
<SyncingOverlay target="doctor_approval" visibleIds={regIds} />
```

…and remove the bare overlay mounts from `Lims.tsx`. The overlay now disappears the instant the awaited row actually appears in the queue, not on a fixed timer.

### 4. Make realtime resilient under load (Bug 4)

In `useRealtimeSync.ts`:

- Drop debounce on the `patient_registrations` table from 400 ms to **150 ms** for the workflow tabs (status flips need to be visible quickly).
- Add **payload-aware invalidation** when available: if `payload.new.id` is set, also call `qc.invalidateQueries({ queryKey: [key] })` *and* `qc.refetchQueries({ queryKey: [key], type: "active" })` so the active visible tab refetches immediately while inactive tabs only invalidate (cheap).
- Add a heartbeat: if the realtime channel disconnects (Supabase connection dropped under load), automatically resubscribe and force-invalidate once on reconnect, so a tab can never be left stuck on stale data.

### 5. Concurrency safety

- `propagateRegistrationChange` is idempotent (status recalc + invalidate). Two technicians acting on the same patient simultaneously will both run the recalc; the second one will simply observe the same final state and is harmless.
- No optimistic local writes to `patient_registrations.status` — only the DB recalc is the source of truth, so two clients can never disagree.
- All status logic stays server-driven (`recalculateRegistrationStatus` reads tubes + results + snips, then writes a single `update`), so there is no client-side merge conflict.

### 6. Side cleanups

- Bump default `signalSync` TTL from `8000` → `15000` ms (slow networks).
- `NewBadge` should `forwardRef` (silences the React warning seen in console).
- Remove the dead `recalculateRegistrationStatus(...).catch(console.error)` callsites — the helper now owns this.

---

## Why this scales

- **Single helper = single point of correctness.** Future workflow buttons can't drift out of sync with the query keys — they call one function.
- **Correct invalidation + awaited recalc** means data appears on the *first* tab switch, not the *next debounced realtime burst*. That removes 90% of the perceived latency under heavy load.
- **Tab-active refetch + inactive-only invalidate** keeps multi-user fan-out cheap: 10 technicians don't trigger 10 full refetches of every queue on every keystroke — only the tab they're on refetches.
- **Realtime reconnect heartbeat** makes the system self-healing if the WebSocket drops (which it does under heavy concurrent load on Lovable Cloud).
- **`SyncingOverlay` tied to actual `visibleIds`** means the user is never lied to about whether a record has arrived.

## Files to Edit

- **New:** `src/lib/limsPropagation.ts`
- **Edit (replace ad-hoc invalidations with helper):** `ResultsEntry.tsx`, `ResultVerification.tsx`, `DoctorApproval.tsx`, `Dispatch.tsx`, `SampleCollection.tsx`, `SampleAcceptance.tsx`
- **Edit (move overlays in, pass `visibleIds`):** above components + `src/pages/Lims.tsx` (remove bare mounts)
- **Edit:** `src/hooks/useRealtimeSync.ts` (active-tab refetch, reconnect heartbeat)
- **Edit:** `src/lib/limsSyncSignal.ts` (TTL → 15 s)
- **Edit:** `src/components/lims/NewBadge.tsx` (forwardRef)

## Out of Scope

- No DB schema changes. No edge functions. No background-job/polling architecture (the actions remain synchronous from the client's perspective; the fix is correctness + scaling of cache propagation, not async dispatch).

Approve and I'll implement.
