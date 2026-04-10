

# Plan: Reorganize Test/Profile Metadata Display

## Current Issue
- **Sample type** appears twice: once beside the profile name (line 300) and again in the meta row below the table (line 344)
- **Instrument name** and **Method** are shown below the table in a meta row — user wants them beside the test/profile name instead
- **Interpretation** should remain below the table (keep as-is)

## Changes — `src/components/report/ReportResultsSection.tsx`

### 1. Profile header line (line 298-301)
Move instrument and method INTO the profile header alongside sample type:
```
{profName} (Sample: X | Instrument: Y | Method: Z)
```

### 2. Remove the meta row below the table (lines 342-348)
Delete the `hasMetaRow` block entirely — sample type, instrument, and method are now shown in the header. Interpretation and outsourced caption stay below.

### 3. Standalone parameters section (lines 240-253)
Same change: move instrument/method into a subtitle line below the parameter, remove the separate meta row. Keep interpretation below.

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — ~20 lines changed

