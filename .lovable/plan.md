# Plan — Cross-Tab Sync Loader + "NEW" Badges in LIMS

Two related quality-of-life upgrades for the LIMS pipeline so the user can see (a) when freshly saved data is still propagating between modules, and (b) which patients are newly arrived in each queue.

---

## 1. Cross-Tab "Syncing…" Loader

**Trigger:** Only when the user has just performed an action in one module that pushes a patient into the next module (Save & Verify, Send Back, Approve, Dispatch, etc.) **and then switches tabs**. Never shown while staying on the same screen.

### Mechanism

- Add a tiny shared store (Zustand or a single React context — pick Zustand to match existing patterns if any; else context) keyed by destination tab:
  ```ts
  // src/lib/limsSyncSignal.ts
  signalSync(target: "verification" | "results" | "doctor_approval" | "dispatch" | "completed_hv", regId: string, ttlMs = 8000)
  consumeSync(target): { active: boolean, regIds: string[] }
  ```
- When `signalSync` is called, it stamps `{target, regIds, expiresAt: now+ttl}` in memory.
- `Lims.tsx` watches `searchParams.tab`. On tab change, if a pending signal exists for that tab whose `regIds` are not yet present in that tab's first query result, render an overlay: small spinner + text "Syncing latest changes…" pinned to the top of the tab content. The overlay auto-dismisses when (a) the regIds appear in the list, or (b) TTL expires.

### Where to call `signalSync`

- **ResultsEntry.tsx** → after Save & Verify success (line ~810 area, the existing invalidate block): `signalSync("verification", reg.id)`.
- **ResultVerification.tsx** → after Send Back success: `signalSync("results", reg.id)`. After Verify success: `signalSync("doctor_approval", reg.id)`.
- **DoctorApproval.tsx** → after Approve success: `signalSync("dispatch", reg.id)`. After Send Back: `signalSync("verification", reg.id)`.
- **Dispatch.tsx** → not needed downstream, but on Send Back: `signalSync("doctor_approval", reg.id)`.
- **CompletedHomeVisits / SampleAcceptance** → similar where applicable.

### Overlay component

`src/components/lims/SyncingOverlay.tsx` — a thin sticky banner (not a full-screen blocker) so the user can still scroll/interact:
```
[spinner] Syncing latest changes from previous step…
```
Mounted once inside each `<TabsContent>` that is a destination tab; reads its own target via prop.

---

## 2. "NEW" Badges Per Module

Show a small `NEW` badge on patient rows that have arrived in that specific module since the user last viewed/clicked them. Clicking the row clears the badge for that module.

### Storage

- Per-module `localStorage` key holding **the set of seen registration IDs** for that module:
  - `lims_seen_results`, `lims_seen_verification`, `lims_seen_doctor_approval`, `lims_seen_dispatch`, `lims_seen_sample_collection`, `lims_seen_sample_acceptance`, `lims_seen_completed_hv`.
- *(Note: project memory disallows localStorage for **data caching**. This is a per-user UI preference — same category as "expanded row state" — not cached server data, so it's acceptable. If the user prefers, we can move it to `app_settings` keyed by username; ask only if they object.)*

### Hook

`src/hooks/useNewArrivalsBadge.ts`:
```ts
useNewArrivalsBadge(moduleKey: string, currentIds: string[])
  → { isNew(id): boolean, markSeen(id): void }
```
Behavior:
- On first ever visit (no key in storage): mark **all** current ids as seen → no badges (avoids flooding).
- On later visits: any id in `currentIds` not in the seen set is `NEW`. Storage is updated to keep only ids still present (prune stale).
- `markSeen(id)` adds the id and persists.

### UI

- Add a small `<Badge variant="destructive" className="ml-2 text-[10px] py-0 px-1.5">NEW</Badge>` next to the patient name in each module's row header.
- Wire `markSeen(reg.id)` into the existing row click / accordion-expand handler for each module.

### Modules to instrument

- ResultsEntry (`results_accepted_regs` list)
- ResultVerification (`verification_regs_v2`)
- DoctorApproval (`doctor_approval_regs`)
- Dispatch (`dispatch_regs`)
- SampleCollection
- SampleAcceptance
- CompletedHomeVisits

---

## Files to Edit

- **New:** `src/lib/limsSyncSignal.ts`, `src/components/lims/SyncingOverlay.tsx`, `src/hooks/useNewArrivalsBadge.ts`.
- **Edit:** `src/pages/Lims.tsx` (mount overlays per destination tab).
- **Edit (signalSync calls + NEW badges + markSeen):** `ResultsEntry.tsx`, `ResultVerification.tsx`, `DoctorApproval.tsx`, `Dispatch.tsx`, `SampleCollection.tsx`, `SampleAcceptance.tsx`, `CompletedHomeVisits.tsx`.

## Out of Scope

- No changes to data fetching cadence — existing `useRealtimeSync` + invalidations already handle propagation; we are only surfacing the in-flight state visually.
- No new database tables.

Approve and I'll implement.
