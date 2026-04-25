## Plan: Polish the rail sidebar scrollbar

The collapsed rail sidebar currently shows the browser's default scrollbar, which looks ugly on the narrow 56px rail (oversized track + arrows in the screenshot).

### Fix

1. **`src/components/AppLayout.tsx`** — add a `sidebar-scroll` class to the desktop `<nav>`:
   - Hide the scrollbar entirely while the sidebar is collapsed (rail state).
   - Show a thin, subtle scrollbar only when hovered (sidebar expanded).

2. **`src/index.css`** — add the `sidebar-scroll` utility:
   - Default: `scrollbar-width: none` (Firefox) and `::-webkit-scrollbar { width: 0 }` to hide the bar in collapsed state.
   - On `aside.group:hover &` (when expanded): show a thin 6px scrollbar with `hsl(var(--muted-foreground) / 0.3)` thumb, transparent track, rounded — matching the design system.
   - No native arrow buttons (`::-webkit-scrollbar-button { display: none }`).

### Result

- Collapsed rail: clean, no scrollbar visible at all.
- Expanded (hover): minimal thin scrollbar that fits the design tokens, no arrow buttons, smooth fade-in.