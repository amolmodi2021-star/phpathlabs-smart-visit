

# Plan: User Management with Roles, Rights & Access Control

## Overview
Build a full user management system where an admin can create users, define reusable role templates with granular permissions (which sidebar tabs and which sub-tabs/sections within each tab a user can access), and enforce those permissions at login and throughout the app.

## Current State
- Authentication uses hardcoded credentials (`PHPATHLABS` / `PHPL6699`) stored in `src/lib/auth.ts`
- No user table, no roles, no per-user access control
- All 17 sidebar nav items are visible to everyone
- Some modules (Loyalty Cards, Marketing, CRM, WhatsApp Webhook) have a secondary PasswordGate

## Database Schema (4 new tables via migration)

### 1. `app_users`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| username | text UNIQUE NOT NULL | Login ID |
| password_hash | text NOT NULL | bcrypt hash (hashed in edge function) |
| display_name | text | |
| role_id | uuid FK → app_roles.id | Assigned role template |
| is_active | boolean DEFAULT true | Active/inactive toggle |
| last_login_at | timestamptz | |
| created_at / updated_at | timestamptz | |

### 2. `app_roles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| role_name | text UNIQUE NOT NULL | e.g. "Receptionist", "Lab Technician", "Admin" |
| description | text | |
| permissions | jsonb NOT NULL DEFAULT '{}' | Full permissions map (see below) |
| created_at / updated_at | timestamptz | |

### 3. `app_user_login_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → app_users.id | |
| login_at | timestamptz DEFAULT now() | |
| ip_address | text | |
| user_agent | text | |

### 4. Permissions JSON structure (stored in `app_roles.permissions`)
```json
{
  "tabs": {
    "/": true,
    "/dashboard": true,
    "/home-visits": true,
    "/lims": {
      "enabled": true,
      "sections": ["register", "patients", "sample_collection"]
    },
    "/crm": false,
    "/tests": false
    // ... all 17 tabs listed
  }
}
```
Each sidebar route is a key. Value is `true`/`false` for simple tabs, or an object with `enabled` + `sections` array for tabs that have sub-tabs (LIMS, CRM, Marketing).

## All Tabs & Their Sections

| Sidebar Tab | Route | Sections (sub-tabs) |
|------------|-------|---------------------|
| Create Estimate | `/` | — (single page) |
| Estimate Dashboard | `/dashboard` | — |
| Home Visits | `/home-visits` | — |
| Phlebotomists | `/phlebotomists` | — |
| Test Management | `/tests` | — |
| Message Templates | `/templates` | — |
| Abnormal History | `/abnormal-history` | — |
| Phlebo Dashboard | `/phlebo-dashboard` | — |
| Loyalty Cards | `/loyalty-cards` | — |
| Marketing | `/marketing` | Sender, Templates, History, Message Log, New Numbers, Automated |
| CRM | `/crm` | Contacts, Import, Sequences, Abnormal Tests, Abnormal WhatsApp, Blacklist, Sent History, Settings |
| LIMS | `/lims` | New Registration, Registered Patients, Sample Collection, Sample Acceptance, Results, Result Verification, Doctor Approval, Dispatch, Completed Home Visits, Pickup Points, Channels |
| WhatsApp Webhook | `/whatsapp-webhook` | — |
| WhatsApp Settings | `/whatsapp-settings` | — |
| LIMS Interface | `/lims-demo` | — |
| Report Layout | `/report-layout` | — |
| Doctor & Signatures | `/signature-management` | — |
| **Users (NEW)** | `/users` | User List, Roles & Rights |

## Implementation Steps

### Step 1: Database migration
- Create `app_roles`, `app_users`, `app_user_login_history` tables with permissive RLS (matching existing pattern).
- Seed a default "Admin" role with all permissions enabled.
- Seed a default admin user (username: `PHPATHLABS`, matching current credentials).

### Step 2: Edge function `user-auth`
- Handles login: validates username + bcrypt password, returns user data + permissions, logs login history.
- Handles password reset (admin resets another user's password).
- No JWT/Supabase Auth needed — keeps the existing session model but stores the logged-in user info (id, username, role, permissions) in localStorage after server-side validation.

### Step 3: Update `src/lib/auth.ts`
- Replace hardcoded credential check with a call to the `user-auth` edge function.
- Store user session (id, username, permissions) in localStorage on successful login.
- Add `getCurrentUser()` and `getUserPermissions()` helper functions.

### Step 4: Update Login page (`src/pages/Login.tsx`)
- Call the edge function instead of the local `login()` function.
- Show error if user is inactive.

### Step 5: New page `src/pages/UserManagement.tsx`
Two tabs:

**Tab 1: User List**
- Table of all users (username, display name, role, active/inactive, last login)
- Add User dialog (username, display name, password, assign role, active toggle)
- Edit user, reset password, toggle active/inactive
- View login history per user

**Tab 2: Roles & Rights**
- List of role templates
- Add/Edit Role dialog with:
  - Role name, description
  - Checkbox tree for all tabs and their sections
  - Visual grouping by module area
- Delete role (only if no users assigned)
- Duplicate role for quick creation

### Step 6: Update `AppLayout.tsx`
- Filter `navItems` based on current user's permissions before rendering.
- Hide tabs the user has no access to.
- Add "Users" nav item (only visible to admin role).

### Step 7: Update `ProtectedRoute` in `App.tsx`
- Check if current user has permission for the current route.
- Redirect to first allowed route if accessing a forbidden page.

### Step 8: Update LIMS, CRM, Marketing pages
- Filter sub-tab triggers based on user's section-level permissions.
- Hide sections the user cannot access.

### Step 9: Remove PasswordGate dependency
- The PasswordGate on Loyalty Cards, Marketing, CRM, WhatsApp Webhook can be removed since access is now controlled by role permissions. (Or keep it as an optional extra layer — will confirm with you.)

## Files to Create/Modify
- **New**: `src/pages/UserManagement.tsx`
- **New**: `supabase/functions/user-auth/index.ts`
- **Modify**: `src/lib/auth.ts`, `src/pages/Login.tsx`, `src/App.tsx`, `src/components/AppLayout.tsx`
- **Modify**: `src/pages/Lims.tsx`, `src/pages/CRM.tsx`, `src/pages/Marketing.tsx` (filter sub-tabs)
- **Migration**: 3 new tables + seed data

## Security Notes
- Passwords are hashed server-side (bcrypt in edge function), never stored in plaintext.
- Permissions are validated both client-side (UI filtering) and checked on login.
- The admin user cannot be deactivated or deleted.
- Only users with the "Users" tab permission can manage users and roles.

