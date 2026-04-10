

# Two-Level Accordion in Results Entry: Tests → Parameters

## Problem
Currently, when a patient row is expanded in Results Entry, all tests with all their parameters are shown at once. The user wants a collapsible two-level approach: first show a list of test names, then clicking a test expands its parameter table.

## Changes — `src/components/lims/ResultsEntry.tsx`

### 1. Add state for expanded tests
Add a new state variable to track which tests are expanded within the expanded patient:
```typescript
const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
```

### 2. Update `renderPatientExpanded` — test rows as collapsible headers
In the section that renders `machineGroups → groupByTest`, wrap each test group so:
- The test header row (showing test name, outsource badge, Save & Verify button) becomes clickable with a chevron toggle
- The parameter `<Table>` underneath is only rendered when the test is in the `expandedTests` set
- Clicking the test header toggles its key (`regId||testId`) in `expandedTests`

### 3. Visual treatment
- Each test row shows: chevron icon, test name, completion count (e.g., "3/5 entered"), outsource badge, and Save & Verify button
- Collapsed state: just the header row with a summary
- Expanded state: header row + full parameter table below it

### 4. Machine-wise mode
Same behavior applies — within each machine group, tests are listed as collapsible rows.

## File
- `src/components/lims/ResultsEntry.tsx`

