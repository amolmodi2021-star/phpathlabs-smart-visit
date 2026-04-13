

# Reorder Test Row Badges in Dispatch

## Change
Reorder the inline elements in each test row (around lines 557-594 in `Dispatch.tsx`) from the current order:

**Current:** TAT → Status → View Snip → WhatsApp → Dispatch

**New:** View Snip → TAT → Status → WhatsApp → Dispatch

## Implementation

**File:** `src/components/lims/Dispatch.tsx` (lines ~557-594)

Move the "View Snip" button (lines 580-584) to render **before** the TAT badge (lines 558-577). The status badge, WhatsApp button, and Dispatch button remain in their current relative order after TAT.

Single block reorder — no logic changes, just rearranging the JSX elements within the flex container.

