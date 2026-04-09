

# Plan: Tab Key Skips to Next Blank Result Input

## What it does
When the user presses **Tab** in a result input field, instead of moving to the next focusable element (unit, ref range, buttons, etc.), it jumps directly to the **next blank result entry input** that needs a value. This speeds up data entry significantly.

## Technical approach

### File: `src/components/lims/ResultsEntry.tsx`

1. **Add a `data-result-input` attribute** to every result `<Input>` and descriptive `<Select>` trigger element (the ones for entering result values — not unit/ref-range inputs). Also attach the current value so we can identify blank ones.

2. **Add an `onKeyDown` handler** to each result input:
   - On `Tab` press (without Shift), call `e.preventDefault()`
   - Query all `[data-result-input]` elements in the current table/container
   - Find the current element's index, then scan forward for the first one whose associated value is blank (empty string)
   - If found, `.focus()` that element; if none found after current position, wrap to the first blank from the top
   - On `Shift+Tab`, do the same but scan backwards

3. **Apply to both views** — the machine-wise expanded row table (~line 860-916) and the patient-wise table (~line 1370-1390) both render result inputs. The same handler applies to both since it uses DOM queries scoped to the closest table container.

4. **Skip calculated/read-only/snip-locked fields** — add `data-result-input` only to editable result fields (not `readOnly` calculated fields, not snip-locked outsourced fields).

