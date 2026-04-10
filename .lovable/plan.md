

# Plan: Filter Results Entry by Accepted Tubes Only

## Root Cause
Registration `2604100001` (HARSHADA) has 3 tubes: S26041000007 (CBC, **pending**), S26041000008 (FBS, accepted), S26041000009 (ANTI CCP, accepted). The registration status is `partially_accepted`, so Results Entry fetches it — but then loads ALL `patient_results` for the registration, including CBC parameters whose tube is still pending.

## Fix
In `ResultsEntry.tsx`, after fetching registrations and their `patient_results`, cross-reference with `sample_tubes` to exclude parameters belonging to tubes that are not yet `accepted`.

### Implementation
1. **In the registration query's data-processing step** (where parameters are built), fetch `sample_tubes` for each registration where `status = 'accepted'`.
2. Build a set of accepted `test_id`s from those tubes' `test_ids` arrays.
3. Filter `patient_results` to only include parameters whose `test_id` is in the accepted set.
4. This way, CBC parameters won't appear until tube S26041000007 is collected and accepted.

### File: `src/components/lims/ResultsEntry.tsx`
- After fetching registrations, also fetch `sample_tubes` for those registration IDs where `status = 'accepted'`
- When building the `ParameterResult[]` array for each patient, skip any parameter whose `test_id` is NOT in the accepted tubes' test_ids
- This ensures only results for accepted samples appear for entry

### No other files need changes.

