
## Goal
Replace the plain `<Select>` dropdown for **descriptive-range parameters** in Results Entry with a **searchable + editable combobox**: user can type to filter the predefined options, click one to select it, and then freely edit the chosen text inline before saving.

## Current behavior
In `src/components/lims/ResultsEntry.tsx`, descriptive parameters render a Radix `<Select>` (two render sites: line ~1145 desktop accordion, line ~1715 mobile/secondary list). Options come from `p.descriptiveOptions`. User can only pick one verbatim — no search, no edit.

## Approach
Build a small inline component `DescriptiveCombobox` reused in both render sites:

- Renders an `<Input>` (so the chosen value is fully editable like any free-text result).
- Right side has a small chevron button that opens a `Popover` containing `Command` + `CommandInput` (search) + `CommandList` of `p.descriptiveOptions` filtered by typed query.
- Selecting an option fills the input with that option's text and closes the popover; the input remains focused and editable.
- onChange of the input fires the existing `handleValueChange(regId, p.parameterId, value, entry)` — same data path as the free-text branch, so persistence/flag/save logic is unchanged.
- Preserves existing keyboard nav: keep `data-result-input`, `data-result-value`, and `onKeyDown={handleResultTabKey}` on the input so Tab/Shift+Tab navigation across results still works.
- Width and styling match current 180px / `w-full` variants via a `className` prop.

## Files to edit
- `src/components/lims/ResultsEntry.tsx`
  - Add a small `DescriptiveCombobox` component (uses existing `Popover`, `Command`, `CommandInput`, `CommandList`, `CommandItem`, `CommandEmpty` from `@/components/ui/command` and `@/components/ui/popover` — both already in the project).
  - Replace the two descriptive `<Select>` blocks (~lines 1145-1158 and ~1715-1728) with `<DescriptiveCombobox ...>`.

## Out of scope
- Numeric and qualitative parameter inputs — unchanged.
- Adding new options to the master descriptive list — that still happens in Test Parameter Manager.
- No DB / RLS changes; no edge function changes.
- No change to flag computation (descriptive still has no flag).

## Expected outcome
For descriptive-range parameters in Results Entry:
- Click input → see all options in a searchable dropdown.
- Type to filter; click to pick.
- After picking, cursor stays in the input — user can append/edit any text freely.
- Saved value = whatever is in the input at save time (matches existing free-text behavior).
- Tab/Shift+Tab navigation across result cells unchanged.
