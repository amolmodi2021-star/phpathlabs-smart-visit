
## Plan: Add Missing LIMS Tabs to User Roles Permissions

### Gap
`src/pages/UserManagement.tsx` LIMS section list is out of sync with `src/pages/Lims.tsx`. Missing entries: **Due Payments, Bad Debts, Daily Report, Settings**. Also includes stale entries `pickup` and `channels` which are no longer top-level LIMS tabs (they now live inside the **Settings** tab via `LimsSettings.tsx`).

### Change
Edit the `/lims` entry's `sections` array in `src/pages/UserManagement.tsx` to exactly match the tabs declared in `Lims.tsx`, in the same order:

```ts
{
  route: "/lims", label: "LIMS",
  sections: [
    { key: "register", label: "New Registration" },
    { key: "patients", label: "Registered Patients" },
    { key: "sample_collection", label: "Sample Collection" },
    { key: "sample_acceptance", label: "Sample Acceptance" },
    { key: "results", label: "Results" },
    { key: "verification", label: "Result Verification" },
    { key: "doctor_approval", label: "Doctor Approval" },
    { key: "dispatch", label: "Dispatch" },
    { key: "due_payments", label: "Due Payments" },
    { key: "bad_debts", label: "Bad Debts" },
    { key: "daily_report", label: "Daily Report" },
    { key: "completed_hv", label: "Completed Home Visits" },
    { key: "settings", label: "Settings" },
  ],
},
```

### Effect
- Admins can now toggle Due Payments, Bad Debts, Daily Report and Settings per role in User Management.
- Removed `pickup` / `channels` because they are sub-tabs inside Settings; granting Settings already exposes them. (No nested-section permission system exists for sub-tabs.)
- Existing roles that had `pickup` / `channels` enabled will simply ignore those keys; no break. New role setups should grant `settings` instead.

### Files
- `src/pages/UserManagement.tsx` — single array edit, ~12 lines

### No other changes
- `Lims.tsx` `getAllowedSections("/lims")` filter logic already supports any new keys.
- No DB / edge function / migration required.
