

## Plan: Per-Profile Toggle for Test Name Grouping

### What Changes

Currently, test-name grouping (showing sub-headers like "DIFFERENTIAL COUNT", "PHYSICAL EXAMINATION" within a profile) is **hardcoded** to only CBC and Urine Routine profiles. The user wants this to be a **per-profile setting** controlled via a toggle in the Profile Management dialog.

### Steps

1. **Database Migration** — Add a boolean column `enable_test_grouping` (default `false`) to the `report_profiles` table. This replaces the hardcoded `TEST_GROUPED_PROFILES` list.

2. **Profile Management UI (`ReportProfiles.tsx`)** — Add a Switch/toggle in the edit/add dialog labeled "Group parameters by test name" (near the existing outsourced checkbox). Wire it to the new `enable_test_grouping` field in the form state and save payload.

3. **Report Rendering (`ReportResultsSection.tsx`)** — 
   - Add `enable_test_grouping` to the `ProfileMeta` interface and accept it via `profileMetaMap`.
   - Replace the hardcoded `isTestGroupedProfile(profName)` check with a lookup: `profileMetaMap?.[profName]?.enable_test_grouping`.
   - Remove the `TEST_GROUPED_PROFILES` constant (keep `COMPACT_PROFILES` and `MORPHOLOGY_TESTS`).

4. **Report Data Flow** — In the page that builds `profileMetaMap` (likely `ViewReport.tsx` or `ReviewReport.tsx`), include `enable_test_grouping` when fetching profile data so it flows through to `ReportResultsSection`.

### Technical Details

**Migration SQL:**
```sql
ALTER TABLE public.report_profiles 
  ADD COLUMN enable_test_grouping boolean DEFAULT false;

-- Set existing CBC/Urine profiles to true for backward compatibility
UPDATE public.report_profiles 
  SET enable_test_grouping = true 
  WHERE lower(profile_name) LIKE '%cbc%' 
     OR lower(profile_name) LIKE '%complete blood count%' 
     OR lower(profile_name) LIKE '%urine routine%';
```

**UI Toggle** — A `Switch` component placed after the "Display Order" field in the profile dialog, with label "Group parameters by test name (like CBC sub-headers)".

**Rendering Logic Change:**
```typescript
// Before (hardcoded):
const isGroupedProfile = isTestGroupedProfile(profName);

// After (data-driven):
const isGroupedProfile = profileMetaMap?.[profName]?.enable_test_grouping ?? false;
```

