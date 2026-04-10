

# Plan: Move Instrument & Method Below Test Header

## Current State
In the profile header (light blue box), sample type, instrument, and method are all shown together:
```
Test Name (Sample: X | Instrument: Y | Method: Z)
```

## Desired State
- **Sample type** stays beside the test name inside the light blue box
- **Instrument** and **Method** move to a new line below the blue box

```
┌─────────────────────────────────────────────┐  ← light blue bg
│ Test Name (Sample: X)                       │
└─────────────────────────────────────────────┘
  Instrument: Y | Method: Z                     ← plain text below
```

## Changes — `src/components/report/ReportResultsSection.tsx`

### Profile header block (lines 298-309)
1. Keep only `sample_type` in the header span inside the blue box
2. Add a new `<div>` after the blue box (outside it) showing instrument and method in smaller gray text

### Standalone parameters section
Apply the same pattern — sample type in the header/subtitle, instrument & method on a separate line below.

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — ~10 lines changed

