

# Dispatch — Collapsible Audit Trail + Latest Status on Card

## What Changes

1. **Remove the status badge** next to the test name in the card header.

2. **Show the latest completed step with timestamp** directly on the test card header (e.g., "Verified — 10-04-2026, 11:00 AM"). This replaces the current badge and gives immediate visibility of where the test is.

3. **Make the full audit trail collapsible** using a dropdown/accordion. The six audit steps (Sample Collected, Sample Accepted, Results Entered, Verified, Approved, Dispatched) will be hidden by default and expandable on click.

## UI Layout Per Test Card

```text
┌──────────────────────────────────────────────────────────┐
│ ▶ CBC (Complete Blood Count)                             │
│   Verified — 10-04-2026, 11:00 AM        [WA] [Dispatch]│
│                                                          │
│   (click ▶ to expand)                                    │
│   ● Sample Collected    10-04-2026, 08:30 AM             │
│   ● Sample Accepted     10-04-2026, 08:45 AM             │
│   ● Results Entered     10-04-2026, 10:15 AM             │
│   ● Verified            10-04-2026, 11:00 AM             │
│   ○ Approved            —                                │
│   ○ Dispatched          —                                │
└──────────────────────────────────────────────────────────┘
```

## Technical Details

**File:** `src/components/lims/Dispatch.tsx`

- Import `Collapsible, CollapsibleTrigger, CollapsibleContent` from the UI library (or use a simple state toggle with `ChevronDown`/`ChevronRight`).
- For each test card, compute the **latest completed step** by iterating audit steps in reverse and finding the first with a timestamp.
- Display that step label + timestamp in the card header area, replacing the `getStatusBadge()` call.
- Wrap the existing audit trail grid in a collapsible section, collapsed by default.
- Remove the `{getStatusBadge(test.status)}` from the header.
- Keep all action buttons (Dispatch, WhatsApp, Snip) in the header as they are.

