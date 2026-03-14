

## Plan: Disambiguate Identical Parameters Using Section Headers (Stool vs Urine)

### Problem

The PDF has "Colour" in both "STOOL EXAMINATION" and "URINE EXAMINATION" sections with the same `test_name`. The current matching uses only `parameter_name` as the lookup key, so both "Colour" rows resolve to the same master entries. The disambiguation then tries exact normalized matching of AI-extracted `profile_name` (e.g., "stool examination") against database profile names (e.g., "urine routine analysis") — which fails because the names differ significantly.

**Current master data:**
- Colour → test_name: "PHYSICAL EXAMINATION", profile: "URINE ROUTINE ANALYSIS"
- Colour → test_name: "PHYSICAL EXAMINATION - STOOL", profile: (none)

### Solution: Composite Key Matching + Fuzzy Profile Disambiguation

#### Step 1: Include `test_name` in master data fetch and build composite keys

In `ReviewReport.tsx` `buildMasterMaps()`:
- Fetch `test_name` alongside other fields from `report_test_parameters`
- Build a composite key `parameter_name::test_name` so "colour::physical examination" and "colour::physical examination stool" are distinct
- Keep the plain `parameter_name` key as fallback

#### Step 2: Use AI-extracted `test_name`/`profile_name` for composite key lookup

In `enrichResults()`:
- Try composite key `normalizedParamName::normalizedAiTestName` first
- Then try `normalizedParamName::normalizedAiProfileName` (since the section header may come as profile_name)
- Fall back to plain `parameter_name` key

#### Step 3: Improve profile disambiguation with keyword matching

Replace the exact match at line 198 with a keyword/partial match — if `aiProfile` contains "stool", match it to a profile containing "stool". This handles "STOOL EXAMINATION" matching "Stool Routine Analysis".

#### Step 4: Update AI prompts to include profile names in known parameters

Both `extract-report` and `process-report-queue` already send the profile name in the `paramList`. Add explicit instruction: "Use the profile column from KNOWN PARAMETERS to populate `profile_name` for each extracted row."

### Technical Details

**`buildMasterMaps()` change:**
```typescript
// Fetch test_name too
supabase.from("report_test_parameters").select("id, parameter_name, test_name, department_id, profile_id")

// Build composite keys
const testKey = normalizeParameterForMatch(p.test_name);
if (testKey) {
  const compositeKey = `${key}::${testKey}`;
  masterMap.set(compositeKey, [...(masterMap.get(compositeKey) || []), entry]);
}
```

**`enrichResults()` composite lookup:**
```typescript
const aiTestKey = normalizeParameterForMatch(r.test_name);
const aiProfileKey = normalizeParameterForMatch(r.profile_name);
const compositeByTest = aiTestKey ? masterMap.get(`${key}::${aiTestKey}`) : undefined;
const compositeByProfile = aiProfileKey ? masterMap.get(`${key}::${aiProfileKey}`) : undefined;
const masterEntries = compositeByTest || compositeByProfile || masterMap.get(key) || [];
```

**Fuzzy profile disambiguation:**
```typescript
// Instead of exact match, use keyword overlap
const byProfile = aiProfile ? profileEntries.find(pe => {
  const dbProf = normalizeParameterForMatch(pe.profileName);
  return dbProf.includes(aiProfile) || aiProfile.includes(dbProf) 
    || aiProfile.split(" ").some(word => word.length > 3 && dbProf.includes(word));
}) : undefined;
```

**AI prompt addition (both edge functions):**
```
PROFILE MAPPING RULE:
- The KNOWN PARAMETERS list includes a "profile" column. Use it to set profile_name for each extracted row.
- Section headers like "STOOL EXAMINATION", "URINE EXAMINATION" should map to the closest known profile name.
- This is critical for disambiguating parameters with identical names across different test sections.
```

### Files to Edit

1. `src/pages/ReviewReport.tsx` — composite key in `buildMasterMaps()`, composite lookup + fuzzy match in `enrichResults()`
2. `supabase/functions/extract-report/index.ts` — add profile mapping instruction to prompt
3. `supabase/functions/process-report-queue/index.ts` — add profile mapping instruction to prompt

