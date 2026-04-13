

# Qualitative Range — Pair-First Dropdown System

## Overview
For qualitative range type, replace the two free-text inputs with two linked dropdowns:
1. **Expected Normal Value** dropdown — select the pair: "Absent / Present", "Reactive / Non Reactive", "Positive / Negative"
2. **Display Text** dropdown — shows the two values from the selected pair for the user to pick one

## Changes

### File: `src/pages/ReportParameters.tsx` (lines ~809–818)

Define a constant:
```ts
const QUALITATIVE_PAIRS = [
  { label: "Absent / Present", values: ["Absent", "Present"] },
  { label: "Reactive / Non Reactive", values: ["Reactive", "Non Reactive"] },
  { label: "Positive / Negative", values: ["Positive", "Negative"] },
];
```

Replace the qualitative section's two `<Input>` fields:

1. **Expected Normal Value** — `<Select>` with 3 options: "Absent / Present", "Reactive / Non Reactive", "Positive / Negative". On selection, store the label as `expected_value` and auto-set `normal_range_text` to the first value of the pair.

2. **Display Text** — `<Select>` whose options are the two values from the currently selected pair. For example if "Absent / Present" is selected, options are "Absent" and "Present".

When loading existing data, reverse-match `expected_value` or `normal_range_text` to detect which pair is active.

No database changes needed.

