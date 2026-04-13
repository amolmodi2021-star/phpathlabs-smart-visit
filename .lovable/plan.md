

# Two Features: Self-Service Password Change + User-Signature Mapping

## Feature 1: Self-Service Password Change

Each logged-in user gets a "Change Password" option accessible from the app header (next to logout).

### Changes:
1. **New component `src/components/ChangePasswordDialog.tsx`** — Dialog with current password, new password, confirm password fields. Calls the `user-auth` edge function.
2. **Update `supabase/functions/user-auth/index.ts`** — Add a `change_password` action that verifies the current password before updating to the new one.
3. **Update `src/components/AppLayout.tsx`** — Add a "Change Password" button/icon in the header bar next to the logout button. Opens the dialog.

## Feature 2: Map App Users to Pathologist Signatures

Link each pathologist signature record to an `app_users` entry so that when a user approves a report, their mapped signature automatically appears.

### Changes:
1. **Database migration** — Add `mapped_user_id UUID` column to `pathologist_signatures` table (nullable, references no FK to avoid issues).
2. **Update `src/pages/SignatureManagement.tsx`** — Add a "Mapped User" dropdown in the add/edit dialog, populated from `app_users`. Show mapped user in the table.
3. **Update `src/components/lims/DoctorApproval.tsx`** — When approving, set `approved_by` to the current logged-in user's `display_name` (from `getCurrentUser()`) instead of the hardcoded `"Doctor"` string.
4. **Report signature resolution already works** — `LimsReportView.tsx` already matches `approved_by` against `pathologist_name`. With the user mapping, we enhance it to also check `mapped_user_id` match. If the `approved_by` name matches a pathologist's mapped user's `display_name`, use that signature.

### Technical Details

**Edge function `change_password` action:**
- Accepts `user_id`, `current_password`, `new_password`
- Verifies current password hash matches
- Hashes new password and updates

**Signature mapping flow:**
- `pathologist_signatures.mapped_user_id` → links to `app_users.id`
- On approval, `approved_by` is set to the current user's display name
- Report view matches `approved_by` against both `pathologist_name` AND the mapped user's display name

### Files to modify:
- **New**: `src/components/ChangePasswordDialog.tsx`
- **Edit**: `supabase/functions/user-auth/index.ts` (add `change_password` action)
- **Edit**: `src/components/AppLayout.tsx` (add change password button)
- **Edit**: `src/pages/SignatureManagement.tsx` (add mapped user dropdown)
- **Edit**: `src/components/lims/DoctorApproval.tsx` (use current user name as `approved_by`)
- **Edit**: `src/pages/LimsReportView.tsx` (enhance signature matching with user mapping)
- **New migration**: Add `mapped_user_id` column to `pathologist_signatures`

