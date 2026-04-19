
## Root cause

The `useQuery` for visits was recently updated (server-side date-window filtering for performance) so its key is now:

```ts
["home_visits", queryDateWindow.from, queryDateWindow.to]
```

But two cache lookups in the multi-patient "Proceed to Payment" flow still use the old key without date params:

```ts
// HomeVisits.tsx lines 998 & 1006
qc.getQueryData<any[]>(["home_visits"])
```

`getQueryData` requires an **exact key match** — with no matching entry it returns `undefined`. So:

- `primaryVisit` = `undefined` → `if (primaryVisit)` fails silently → no payment dialog opens.
- `allVisits` = `[]` → consolidated payment dialog also can't open.

Result: clicking "Proceed to Payment" closes the patient list dialog and does **nothing** — the visit stays Pending. This is the regression the user is seeing. Yesterday the key was just `["home_visits"]` so the lookup worked.

The same anti-pattern also exists in `qc.invalidateQueries({ queryKey: ["home_visits"] })` calls — those still work because `invalidateQueries` does **prefix** matching by default, not exact match. Only `getQueryData` is affected.

## Fix — `src/pages/HomeVisits.tsx`

Replace both `qc.getQueryData<any[]>(["home_visits"])` lookups with the in-scope `visits` array that already comes from the same `useQuery`:

```ts
// Before:
const primaryVisit = qc.getQueryData<any[]>(["home_visits"])?.find(...)
const allVisits = allIds.map(id => qc.getQueryData<any[]>(["home_visits"])?.find(...))

// After:
const primaryVisit = visits.find((v: any) => v.id === multiPatientSession?.primaryVisitId);
const allVisits = allIds.map(id => visits.find((v: any) => v.id === id)).filter(Boolean);
```

Since the preceding `await qc.refetchQueries({ queryKey: ["home_visits"] })` re-runs the active query, the component re-renders with fresh `visits` before the click handler reads it (the closure captures the latest render's `visits`). To be extra safe and avoid any stale-closure issues, fetch the freshly-updated row directly from Supabase as a fallback when not found in the cache.

### Concrete changes (single file)

`src/pages/HomeVisits.tsx`:

1. Lines 995–1011 (Proceed to Payment handler): use `visits.find(...)` instead of `qc.getQueryData(...)`.
2. Optional hardening: if `primaryVisit` is still falsy, surface a `toast.error("Could not load visit — please refresh.")` so this kind of silent failure is never invisible again.

## Out of scope

- No DB / migration changes.
- No change to validation logic in `EditHomeVisitDialog` (warning icons users saw are the existing required-field indicators in completion mode and are working correctly).
- No change to the date-window filtering — that performance win stays.

## Expected outcome

- Clicking Mark as Completed opens the completion edit dialog (already works).
- Saving opens the multi-patient list dialog (already works).
- Clicking "Proceed to Payment" now correctly opens the Payment Details dialog → user enters payment → visit flips to Completed.
- Both single- and multi-patient flows restored.
