

## Root cause

Permissions are loaded **only at login** and cached in `localStorage` (`ph_pathlabs_user`). When you (PHPATHLABS) update the Administrator role in `/users`, the database is updated correctly (verified — Admin role has all the new tabs/sections including `bad_debts`, `daily_report`, etc., last updated 2026-04-17 13:09 UTC), but your browser keeps showing the **old cached permissions** from your previous login.

Logging out and logging back in would fix it for one session — but that's a poor UX, and you'd hit the same problem every time you tweak a role.

## Fix plan

### A. Auto-refresh permissions for the logged-in user

`src/lib/auth.ts` — add `refreshCurrentUserPermissions()`:
- Re-fetches the user's current `role_id` and the role's `permissions` JSON from `app_users` + `app_roles`.
- Updates `localStorage` `ph_pathlabs_user` with the fresh permissions.
- Returns the refreshed user.

### B. Trigger refresh on key moments

`src/components/AppLayout.tsx` (or a new tiny hook in `src/hooks/`):
- On mount + on every route change → call `refreshCurrentUserPermissions()` silently.
- Listen to `window` `focus` event → refresh when user tabs back to the app.
- This guarantees permissions are at most one navigation/tab-switch stale.

### C. Immediate refresh after editing a role

`src/pages/UserManagement.tsx` — after a successful "Save Role" mutation:
- If the edited `role_id === currentUser.role_id`, call `refreshCurrentUserPermissions()` right away.
- Toast: "Permissions updated — sidebar will refresh."
- Force a sidebar re-render (lightweight state bump).

### D. Sidebar / route guard reactivity

`src/components/AppLayout.tsx` — the sidebar currently reads permissions synchronously from `localStorage`. Wrap that read in component state seeded from `getCurrentUser()`, and update it whenever `refreshCurrentUserPermissions()` runs (via a custom event `ph:permissions-updated` dispatched from `auth.ts`). Sidebar listens and re-renders.

### E. One-off: force YOUR current session to pick up the new permissions

No code change needed for this — once Fix A+B ship, your next route change or tab focus will auto-refresh. As an immediate workaround right now you can log out and log back in.

## Out of scope
- No DB changes.
- No edge function changes (existing `user-auth` already returns fresh permissions on login).
- Role editing UI itself — already works, DB is correct.

## Files
- `src/lib/auth.ts` — add `refreshCurrentUserPermissions()` + `ph:permissions-updated` custom event dispatch (~25 lines).
- `src/components/AppLayout.tsx` — call refresh on mount/route-change/focus; subscribe to event; make sidebar permissions reactive (~20 lines).
- `src/pages/UserManagement.tsx` — call refresh after saving a role that matches current user's `role_id` (~5 lines).

