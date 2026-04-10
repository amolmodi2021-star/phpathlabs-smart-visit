

# Per-Tube Acceptance Tracking with Badges and Timestamps

## Overview
Mirror the `collected_samples` pattern from Sample Collection: track which individual tubes have been accepted (with timestamps) in a new `accepted_samples` JSONB column, then use it to show accepted tubes with badges in both Pending and Accepted views.

## Database Migration
Add `accepted_samples` JSONB column (default `'[]'`) to `patient_registrations`. Format mirrors `collected_samples`: `[{ "key": "tube||suffix", "accepted_at": "ISO timestamp" }]`.

## Code Changes — `src/components/lims/SampleAcceptance.tsx`

### 1. Parse accepted_samples helper
Add `parseAcceptedSamples` (same pattern as `parseCollectedSamples` in SampleCollection) to handle both old string arrays and new object arrays with backward compatibility.

### 2. Accept Mutation — store per-tube timestamps
When accepting tubes, append entries like `{ key: "EDTA||", accepted_at: new Date().toISOString() }` to the `accepted_samples` array. Only set status to `sample_accepted` when ALL tube groups are present in `accepted_samples`.

### 3. Pending Tab — show accepted tubes with ACCEPTED badge + timestamp
- Keep the patient visible in pending as long as not all tubes are accepted
- For each tube group in the expanded detail, if it's already in `accepted_samples`, show a green "ACCEPTED" badge with the `dd-MM-yyyy hh:mm a` timestamp and hide the Accept/Repeat buttons for that tube
- Filter out already-accepted tubes from the "select all" checkbox logic
- Show "PARTIAL" badge on the patient row if some (not all) tubes are accepted

### 4. Accepted Tab — show only accepted tubes with PARTIAL badge
- Update query to: `.or("status.eq.sample_accepted,accepted_samples.neq.[]")`
- In the expanded detail, filter tube groups to show only those present in `accepted_samples`
- Show "PARTIAL" badge on the patient row if status is not yet `sample_accepted`
- Display accepted timestamp per tube in `dd-MM-yyyy hh:mm a` format

### 5. Barcode scan update
When a scanned barcode matches an already-accepted tube, skip it with a toast message instead of re-accepting.

## Files
- **Migration**: Add `accepted_samples` JSONB column
- **`src/components/lims/SampleAcceptance.tsx`**: All logic and UI changes

