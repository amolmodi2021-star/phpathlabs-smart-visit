

# Fix: Accept Mutation Using Non-Unique sampleId Instead of Tube Key

## Problem
When accepting the EDTA tube for invoice `2604100001`, the PLAIN tube also gets marked as accepted — even though it was never collected.

**Root cause:** The accept mutation on line 258 filters accepted groups by `g.sampleId`:
```typescript
const acceptedGroups = groups.filter(g => acceptedSampleIds.includes(g.sampleId));
```

For tubes without a custom suffix, `sampleId` equals the invoice number (e.g. `2604100001`). Since both EDTA and PLAIN share the same `sampleId`, accepting one accepts both.

The unique identifier is `g.key` (e.g. `EDTA||`, `PLAIN||`), not `g.sampleId`.

## Database Evidence
- `collected_samples`: only `EDTA||`
- `accepted_samples`: both `EDTA||` AND `PLAIN||` (incorrect — PLAIN was never collected)

## Fix — `src/components/lims/SampleAcceptance.tsx`

### 1. Change selection key format to use tube `key` instead of `sampleId`

Throughout the component, the selection key is `${reg.id}||${g.sampleId}`. Change this to `${reg.id}||${g.key}` so each tube is uniquely identified.

Affected locations:
- **`sampleIdToRegMap`** (line 218): Use `g.key` in the composite key
- **`toggleAllForReg`** (line 241): Use `g.key`
- **`handleAcceptSelected`** (line 354): Parse `key` part instead of `sampleId`
- **Checkbox `value`** in the table rendering: Use `g.key`

### 2. Fix the accept mutation to filter by `key`

Line 258 — change from filtering by `sampleId` to filtering by `key`:
```typescript
const acceptedGroups = groups.filter(g => acceptedKeys.includes(g.key));
```

### 3. Fix "all groups accepted" check to only consider collected groups

Lines 299-302 check if ALL tube groups are accepted to set status to `sample_accepted`. This should only consider **collected** groups, not all possible groups. Otherwise a partially collected registration could never reach `sample_accepted`.

```typescript
const collectedGroups = getCollectedGroups(reg, groups);
const allCollectedKeys = new Set(collectedGroups.map(g => g.key));
const allCollectedAccepted = [...allCollectedKeys].every(k => allAcceptedKeys.has(k));
```

### 4. Data fix: Remove the incorrectly accepted PLAIN entry

Run a migration to clean up the bad data for invoice `2604100001`, removing the `PLAIN||` entry from `accepted_samples` since it was never collected.

## Files
- `src/components/lims/SampleAcceptance.tsx` — fix selection keys and accept logic
- Database migration — clean up incorrect accepted_samples data

