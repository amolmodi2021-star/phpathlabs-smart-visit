

## Goal
In Home Visits, when a visit has been registered in LIMS (status = `Registered` via the Completed Home Visits → Edit & Register flow), do NOT block editing outright. Instead, require password `9819111107` to unlock — same gate that already protects `Completed` visits.

## Current behaviour (`src/pages/HomeVisits.tsx`, `openEditDialog`, lines 327–338)
```ts
if (v.status === "Registered") {
  toast.error("This visit has been registered. Changes are no longer allowed.");
  return;          // ← hard block
}
if (v.status === "Completed") {
  setPendingEditVisit(v);
  setEditPasswordDialog(true);   // ← password gate
} else {
  setEditVisit(v);
}
```

## Fix — single file change

`src/pages/HomeVisits.tsx`, `openEditDialog`:

```ts
if (v.status === "Completed" || v.status === "Registered") {
  setPendingEditVisit(v);
  setEditPasswordDialog(true);
} else {
  setEditVisit(v);
}
```

Update the password dialog description (line 1134) to reflect both cases:
```ts
description="Enter password to edit a completed or registered visit record."
```

The existing `DeletePasswordDialog` already enforces `9819111107` (project-wide standard). Once unlocked, the existing `EditHomeVisitDialog` opens normally — no other change needed.

## Why this is safe
- `EditHomeVisitDialog` only updates the `home_visits` row (logistics, address, payment). It does NOT touch the linked `patient_registrations` row created by Edit & Register, so LIMS data integrity is preserved.
- Status remains `Registered` (the dialog won't downgrade it).
- Other guards (Completed Home Visits tab, dispatch flow) are unaffected.

## Out of scope
- No DB changes.
- No change to `CompletedHomeVisits.tsx`, `EditAndRegisterHomeVisitDialog`, or LIMS registration logic.
- Payment edit / cancel / delete flows already have their own password gates — untouched.

## Expected outcome
- Clicking edit on a `Registered` home visit opens the password dialog (instead of showing the "no longer allowed" toast).
- Entering `9819111107` → opens `EditHomeVisitDialog` → user can amend logistics/contact details for after-the-fact corrections.
- Wrong password → existing error toast, no edit.

