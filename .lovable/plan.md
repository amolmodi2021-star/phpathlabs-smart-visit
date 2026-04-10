

# Allow Partially Accepted Samples to Flow Through the Entire Pipeline

## Problem
Currently, only registrations with `status = "sample_accepted"` appear in Results Entry, Result Verification, Outsourced Results, Doctor Approval, and Dispatch. Partially accepted samples (where some tubes are accepted via `accepted_samples` but status hasn't changed to `sample_accepted`) are excluded from the entire downstream pipeline.

## Solution
Update the query filters in all downstream LIMS modules to include registrations that have any accepted samples, even if the overall status hasn't yet reached `sample_accepted`.

## Changes

### 1. `src/components/lims/ResultsEntry.tsx` (line 120)
Change:
```typescript
.eq("status", "sample_accepted")
```
To:
```typescript
.or("status.eq.sample_accepted,accepted_samples.neq.[]")
```

### 2. `src/components/lims/OutsourcedResults.tsx` (line 132)
Same change — replace `.eq("status", "sample_accepted")` with `.or("status.eq.sample_accepted,accepted_samples.neq.[]")`.

### 3. `src/components/lims/ResultVerification.tsx` (line 91)
Change:
```typescript
.in("status", ["sample_accepted", "entered"])
```
To:
```typescript
.or("status.in.(sample_accepted,entered),accepted_samples.neq.[]")
```

### 4. `src/components/lims/DoctorApproval.tsx` (line 58)
Change:
```typescript
.in("status", ["sample_accepted", "entered", "verified"])
```
To:
```typescript
.or("status.in.(sample_accepted,entered,verified),accepted_samples.neq.[]")
```

### 5. `src/components/lims/Dispatch.tsx` (line 48)
Change:
```typescript
.in("status", ["sample_accepted", "entered", "verified", "approved", "dispatched"])
```
To:
```typescript
.or("status.in.(sample_accepted,entered,verified,approved,dispatched),accepted_samples.neq.[]")
```

### 6. Add "PARTIAL" badge in Results Entry and downstream
In each module, show a "PARTIAL" badge next to the patient name when `status !== "sample_accepted"` and `accepted_samples` is non-empty, so technicians can see which patients are partially accepted.

## Files
- `src/components/lims/ResultsEntry.tsx`
- `src/components/lims/OutsourcedResults.tsx`
- `src/components/lims/ResultVerification.tsx`
- `src/components/lims/DoctorApproval.tsx`
- `src/components/lims/Dispatch.tsx`

No database migration needed — uses the existing `accepted_samples` column.

