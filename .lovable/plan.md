
## Goal
In Registered Patients, restrict Bill Cancellation:
- **Same-day bill** (invoice prefix YYMMDD == today): allowed normally (existing flow).
- **Older bill** (invoice prefix < today): require password `9819111107` before opening the cancellation flow.

## Where the cancellation lives
`src/components/lims/EditRegistrationDialog.tsx` houses the "Cancel Bill" action triggered from the Registered Patients table. That's where the gate must sit (the row-level "Edit" button in `RegisteredPatients.tsx` opens this dialog).

I'll confirm the exact button/handler by reading `EditRegistrationDialog.tsx` during implementation, but the cancel-bill trigger is unambiguously inside that dialog.

## Implementation

1. **Reuse existing password dialog**: `src/components/DeletePasswordDialog.tsx` already enforces `9819111107`. Import it into `EditRegistrationDialog.tsx`.

2. **Add gate state** in `EditRegistrationDialog.tsx`:
   ```ts
   const [showOldCancelPwd, setShowOldCancelPwd] = useState(false);
   ```

3. **Derive bill date from invoice prefix** (consistent with the existing cross-day logic already in this file):
   ```ts
   const isOldBill = (() => {
     const inv = registration?.invoice_number || "";
     if (!/^\d{6}/.test(inv)) return false;
     const billDate = `${inv.slice(4,6)}-${inv.slice(2,4)}-20${inv.slice(0,2)}`;
     return billDate !== format(new Date(), "dd-MM-yyyy");
   })();
   ```

4. **Wrap the Cancel Bill button handler**:
   - If `isOldBill` → `setShowOldCancelPwd(true)` (open password dialog).
   - Else → run the existing cancel-bill flow directly.
   - On password success → run the same existing cancel-bill flow.

5. **Render** `<DeletePasswordDialog>` at the bottom with `description="This bill is from an earlier date. Enter password to cancel."`.

## What stays the same
- Same-day cancellation UX is unchanged.
- No DB schema, RLS, or transaction-logging changes.
- All existing refund + cancellation marker logic (and the cross-day "Old Bill" labeling already in place) untouched.
- No changes to `RegisteredPatients.tsx`.

## Files
- `src/components/lims/EditRegistrationDialog.tsx` — add state, gate the cancel handler, render password dialog (~15 lines).
