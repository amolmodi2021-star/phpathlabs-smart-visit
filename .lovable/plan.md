

## Diagnosis

The lock logic in `src/components/EditHomeVisitDialog.tsx` is currently driven by `useState(false)` + `useEffect` (lines 76, 175). On first render after the dialog opens, `phleboLocked` is still `false` until the effect runs — and there are several scenarios where the effect can be skipped or stale:

1. The effect bails out via `if (!visit || !est) return;` (line 160) **before** the lock state gets reset, so if the dialog was previously opened on a Pending visit (lock=false) and the new Registered visit's `est` is briefly null between renders, the lock stays `false`.
2. The dialog component is mounted persistently in `HomeVisits.tsx` (line 1083), so `phleboLocked` state survives between opens. If the previous open was a non-Registered visit, the stale `false` value is shown.
3. `useState`/`useEffect` round-trip means the very first paint after the visit prop changes shows the editable `<Select>` before the effect fires the lock.

## Fix — single file: `src/components/EditHomeVisitDialog.tsx`

Replace the `phleboLocked` state with a **derived value** computed every render directly from the current `visit` prop. Lock state then can never go stale and there is no first-paint flash of the editable Select. The unlock action (password success) is tracked by a separate "unlocked override" state that resets whenever the visit changes.

### Changes

1. **Remove** `const [phleboLocked, setPhleboLocked] = useState(false);` (line 76).
2. **Add** in its place:
   ```ts
   const [phleboUnlockedForVisitId, setPhleboUnlockedForVisitId] = useState<string | null>(null);
   const phleboLocked = visit?.status === "Registered" && phleboUnlockedForVisitId !== visit?.id;
   ```
3. **Remove** `setPhleboLocked(visit?.status === "Registered");` from the effect (line 175). The derived value handles it automatically.
4. **Update** the password-success handler (line 676):
   ```tsx
   onSuccess={() => setPhleboUnlockedForVisitId(visit?.id || null)}
   ```
5. Reset `phleboUnlockedForVisitId` to `null` when the dialog closes, so re-opening the same Registered visit re-locks it:
   ```ts
   onClose={() => { setPhleboUnlockedForVisitId(null); onClose(); }}
   ```
   Wire this through the existing `<Dialog open={open} onOpenChange={(o) => !o && onClose()}>` — call `setPhleboUnlockedForVisitId(null)` inline before `onClose()`.

### Why this is robust

- `phleboLocked` is a pure function of the live `visit` prop → no stale state, no useEffect timing race.
- Reopening any Registered visit always starts locked (override is per-visit-id and reset on close).
- Non-Registered visits: `phleboLocked` is always `false` → Select is editable as today.
- Password gate (`9819111107`) and the existing locked UI block (lines 505–530) stay exactly as they are.

## Out of scope
- No DB changes.
- No change to `HomeVisits.tsx` row-level password gate.
- No change to completion-mode disabled phleb input (already read-only by design).

## Expected outcome
- Clicking pencil on a Registered visit → password (existing) → dialog opens → **Assign Phlebotomist immediately shows the disabled name + Unlock button**, with no flash of the editable Select.
- Clicking Unlock → enter `9819111107` → field becomes the searchable Select. Pick a different phleb → Save persists.
- Closing and reopening the same visit re-locks the field.
- Pending / Cancelled / Completed visits behave exactly as today (Select editable for non-Registered).

