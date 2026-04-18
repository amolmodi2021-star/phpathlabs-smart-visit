
## Goal
Make the descriptive combobox in Results Entry behave as an inline type-ahead: typing in the input itself filters a dropdown of matching `descriptiveOptions`, arrow keys navigate the list, Enter selects, and after selection the text remains editable in the same input.

## Current state
The just-built `DescriptiveCombobox` in `src/components/lims/ResultsEntry.tsx` requires clicking a chevron to open a separate `Command` popover with its own search box. User wants the input itself to be the search box.

## Approach
Rewrite `DescriptiveCombobox` (in `src/components/lims/ResultsEntry.tsx`) as a single `<Input>` with a floating suggestion list directly below it — no chevron, no separate search box.

Behavior:
- **Typing** in the input fires `onChange` (saves immediately, same as today) AND opens a floating `<ul>` of options whose text matches the current input value (case-insensitive substring; if input is empty, show all options).
- **Focus** opens the dropdown showing all options (or filtered by current value).
- **Blur** closes the dropdown (with a small delay so clicks on items register).
- **ArrowDown / ArrowUp** moves a `highlightedIndex` through the visible options; the highlighted item gets `bg-accent`. Auto-scrolls into view.
- **Enter** when dropdown is open and an item is highlighted → fills the input with that option's text, closes the dropdown, keeps focus in the input so user can keep editing. Does NOT advance to next cell.
- **Enter** when dropdown is closed (or no highlight) → falls through to existing `handleResultTabKey` behavior.
- **Escape** closes the dropdown without changing value.
- **Tab / Shift+Tab** closes the dropdown and lets `handleResultTabKey` move focus to the next/prev result cell — keyboard navigation across cells unchanged.
- **Mouse click** on an item → same as Enter-select.

Implementation details:
- One small component, local state: `open: boolean`, `highlightedIndex: number`.
- Filter list: `options.filter(o => o.toLowerCase().includes(value.toLowerCase()))`; if value is empty → all options.
- Dropdown is an absolutely-positioned `<ul>` below the input (`absolute top-full left-0 mt-1 w-full max-h-60 overflow-y-auto z-50 bg-popover border rounded-md shadow-md`), so it overlays the table without affecting layout.
- Keep `data-result-input`, `data-result-value`, and pass-through `onKeyDown={handleResultTabKey}` so existing Tab/Shift+Tab navigation across result cells continues to work — we only intercept ArrowUp/ArrowDown/Enter/Escape when the dropdown is open.

## Files to edit
- `src/components/lims/ResultsEntry.tsx` — replace the `DescriptiveCombobox` component body with the inline-typeahead implementation. The two render sites already pass `value`, `options`, `onChange`, `onKeyDown`, `className` — no call-site changes needed. Remove now-unused `Popover`/`Command`/`ChevronsUpDown` imports if not used elsewhere.

## Out of scope
- Numeric/qualitative inputs.
- Adding new options to the master list.
- DB / RLS / edge function changes.
- Flag computation.

## Expected outcome
- Click into a descriptive result cell → dropdown opens showing all options.
- Start typing → list filters live as you type; the typed text is also the saved value.
- Press ↓/↑ to highlight, Enter to fill the input with that option (input stays focused and editable, dropdown closes).
- Continue typing to append/edit freely.
- Tab/Shift+Tab still moves to the next/prev result cell as before.
