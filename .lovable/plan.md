

## Plan: Profile as a Group of Parameters

### Problem
Currently, each parameter individually references a profile via `profile_id`. The user wants profiles to be defined as a **group of specific parameters**, and during review, a profile name should only appear if ALL parameters belonging to that profile are present in the extracted data.

### Database Change

**New table: `profile_parameters`** (junction table)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| profile_id | uuid | FK to report_profiles |
| parameter_id | uuid | FK to report_test_parameters |
| display_order | integer | Order of parameter within the profile |
| created_at | timestamptz | default now() |

This replaces the current `profile_id` column on `report_test_parameters` for the purpose of profile grouping. The existing `profile_id` on parameters can remain but will no longer drive the review screen logic.

### UI Changes

**1. Profile Management Page (`ReportProfiles.tsx`)**
- In the Add/Edit Profile dialog, add a section to select and order parameters
- Show a multi-select list of available parameters from `report_test_parameters`
- Allow drag-to-reorder or manual display_order input for each selected parameter
- Show the count of parameters per profile in the table

**2. Review Extracted Data (`ReviewReport.tsx`)**
- On data load, fetch all profiles with their linked parameters from `profile_parameters`
- For each profile, check if ALL its member parameters exist in the extracted results (case-insensitive name match)
- If yes: assign the profile name to all matching parameters' `profile_name` field
- If no (incomplete match): leave `profile_name` blank for those parameters
- This replaces the current per-parameter `profile_id` lookup for the profile column

### Profile Matching Logic (pseudocode)
```text
For each profile:
  Get all parameter names linked to it
  Check if every parameter name exists in extracted results
  If ALL present → tag those rows with profile_name
  If ANY missing → leave profile_name blank
```

### Files to Modify
- **Migration**: Create `profile_parameters` table with RLS
- **`ReportProfiles.tsx`**: Add parameter selection UI in the dialog, show parameter count in table
- **`ReviewReport.tsx`**: Replace per-parameter profile lookup with group-based matching logic

### Technical Details
- The junction table allows many-to-many but practically each parameter belongs to at most one profile
- Profile matching is done client-side after fetching `profile_parameters` with joined parameter names
- The `display_order` in `profile_parameters` controls parameter ordering within a profile for report generation

