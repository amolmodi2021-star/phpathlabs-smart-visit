

# Plan: Mobile-Responsive Dispatch Page

## Problem
The Dispatch page uses a fixed side-by-side split layout (`w-[380px]` left panel + flex-1 right panel) that doesn't adapt to mobile screens. On small screens, the patient list and detail panel are cramped/invisible, and the horizontal badge rows overflow.

## Approach
Convert to a single-column stacked layout on mobile using the existing `useIsMobile` hook. On mobile, show only one panel at a time — patient list by default, then detail view when a patient is tapped (with a back button to return).

## Changes (single file: `src/components/lims/Dispatch.tsx`)

1. **Import `useIsMobile`** hook.

2. **Add `mobileShowDetail` state** — tracks whether mobile is showing the detail panel. Set to `true` when a patient is tapped, `false` when back is pressed.

3. **Date filter row** — wrap in `flex-wrap` so it stacks on small screens.

4. **Mobile layout** — when `isMobile`:
   - If `!mobileShowDetail`: show only the patient list card at full width (`w-full`) instead of `w-[380px]`, remove the right panel from DOM.
   - If `mobileShowDetail`: hide the patient list, show only the detail card at full width with a "← Back" button in the header.
   - On patient tap: set `mobileShowDetail = true`.

5. **Desktop layout** — unchanged (current side-by-side).

6. **Right panel header** — on mobile, stack the patient info and action buttons vertically. Wrap action buttons in a scrollable row.

7. **Test card badges** — on mobile, hide the 6 step-badges row (they overflow). Show only the current status badge and TAT. The full audit trail is still available via the collapsible.

8. **Test card action buttons** — stack vertically or use icon-only buttons on mobile.

