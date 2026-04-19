

## Goal
For Registered home visits (registered via Completed Home Visits → Edit & Register in LIMS), allow opening the edit dialog (already done — password gate at the row level), but lock the **Assign Phlebotomist** field specifically. Changing it requires entering password `9819111107` again.

## Why
Once a visit is registered in LIMS, the assigned phlebotomist becomes part of the clinical/operational audit trail. Other logistics (address, time, contact) can be amended freely after the row-level password unlock, but the phlebotomist assignment must stay intentional and auditable.

## Fix — `src/components/EditHomeVisitDialog.tsx`

1. Add local state `phleboLocked` initialised to `visit?.status === "Registered"` (in the same effect that resets fields when the dialog opens).
2. Add `phleboPasswordOpen` state for the unlock dialog.
3. In the Assign Phlebotomist block (lines 498–514):
   - When `phleboLocked === true`, render the field as a **disabled** input showing the current phleb name + a small "Unlock" button (lock icon) next to it.
   - Clicking Unlock opens `DeletePasswordDialog` (already enforces `9819111107` project-wide).
   - On successful password → `setPhleboLocked(false)` → the existing `<Select>` becomes editable.
4. Non-registered visits: unchanged — Select stays editable as today.
5. Once unlocked within the session, it stays unlocked until the dialog closes (re-locks automatically on next open).

### Pseudocode for the affected block
```tsx
{phleboLocked ? (
  <div className="flex gap-2">
    <Input value={phleboName} disabled className="bg-muted flex-1" />
    <Button type="button" variant="outline" size="sm" onClick={() => setPhleboPasswordOpen(true)}>
      <Lock className="h-4 w-4 mr-1" /> Unlock
    </Button>
  </div>
) : (
  <Select value={phlebotomistId} onValueChange={setPhlebotomistId}> … </Select>
)}

<DeletePasswordDialog
  open={phleboPasswordOpen}
  onOpenChange={setPhleboPasswordOpen}
  onSuccess={() => setPhleboLocked(false)}
  description="Enter password to change phlebotomist for a registered visit."
/>
```

## Out of scope
- No DB / migration changes.
- No change to `HomeVisits.tsx` row-level gate (already in place for Completed + Registered).
- Phlebotomist Management page (staff records) — untouched.
- Phlebo Dashboard — read-only, untouched.
- Wrong password → existing toast from `DeletePasswordDialog`, no unlock.

## Expected outcome
- Open a Registered home visit → password prompt (existing) → dialog opens.
- Phlebotomist field is locked (greyed out, with current name + Unlock button).
- Click Unlock → enter `9819111107` → field becomes a Select; pick a different phleb → Save updates `home_visits.phlebotomist_id`.
- All other fields (address, time, contact, tests, payment) remain editable as before.
- Non-Registered visits behave exactly as today.

