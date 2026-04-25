## Plan

### 1. Hover-Expand Collapsible Sidebar (`src/components/AppLayout.tsx`)

Convert the desktop sidebar from a fixed 224px width (`w-56`) to an auto-expanding "rail" that shows only icons by default and expands on hover.

**Behavior:**
- Default state: narrow rail (~56px / `w-14`) showing only nav icons + tooltips on hover.
- On mouse enter: smoothly expands to full width (`w-56`) revealing labels.
- On mouse leave: collapses back to rail width.
- Uses CSS `group-hover` + `transition-all duration-200` for smooth animation (no JS state needed, avoids re-renders).
- Main content area (`<main>`) keeps `flex-1` so it automatically reclaims the freed space when the sidebar is collapsed — maximum screen utilisation when not hovering.
- Mobile (drawer) behavior is unchanged.

**Visual details:**
- Rail icons stay centered when collapsed; labels fade in on hover via `opacity-0 group-hover:opacity-100`.
- "PH PathLabs" header label and user name remain in the top header (already outside sidebar) — unaffected.
- Storage Cleanup button gets the same treatment (icon visible, label hidden when collapsed).
- Active route still highlighted by the existing `NavLink` styling.

### 2. Default Today's Date in Registered Patients (`src/components/lims/RegisteredPatients.tsx`)

**Default date filter:**
- Initialize both `fromDate` and `toDate` with `new Date()` (today) on mount.
- This makes the initial query load only today's registrations → much faster first paint.
- The "Clear dates" button continues to work for users who want a wider window.

**Search bypass for date filter:**
- When the user types in the search box (`debouncedSearch` is non-empty), the date filter is **ignored** in both the count query and the data query.
- Implementation: in the two `useQuery` queryFns, only apply `gte("created_at", fromIso)` / `lte("created_at", toIso)` when `!debouncedSearch`.
- Effect: typing a name/mobile/invoice/UMR searches across **all** historical registrations regardless of the date pickers, so older patients are still findable.
- The query keys already include `debouncedSearch`, `fromIso`, `toIso`, so React Query will correctly refetch when search is cleared and the date filter re-applies.

**UI hint (optional but small):**
- When a search term is active, show a subtle muted text next to the date pickers like "(date filter ignored while searching)" so the user understands why dates appear set but results span all dates.

### Technical Notes

- No database changes.
- No new dependencies.
- Sidebar uses pure Tailwind `group` / `group-hover:` utilities — no shadcn `Sidebar` provider migration needed (keeping the change minimal and consistent with the existing custom layout).
- `overflow-hidden` on the `<aside>` ensures labels don't visually leak during the width transition.
- Mobile detection (`useIsMobile`) continues to gate desktop vs drawer behavior — hover-expand applies only to desktop.

### Files Changed
- `src/components/AppLayout.tsx` — hover-expand rail behavior for desktop sidebar.
- `src/components/lims/RegisteredPatients.tsx` — default `fromDate`/`toDate` to today; bypass date filter when search is active.
