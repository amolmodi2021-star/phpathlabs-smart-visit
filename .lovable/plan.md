
## Goal
1. Apply the same inline type-ahead descriptive combobox to **Result Verification** and **Doctor Approval**.
2. Fix carry-forward: free-text edited values saved in Results Entry must show in Verification and Approval.
3. Make the full text visible after selection/edit (no clipping under the field box).

## Root cause of carry-forward bug
Values ARE saved correctly in `patient_results.result_value` and read back into `resultValue`. The bug is purely UI: Verification & Approval still use Radix `<Select>` for descriptive parameters. Radix Select silently renders **empty** when the current value is not in its `<SelectItem>` list — so any free-text or edited descriptive value saved from Results Entry appears blank. Switching to the editable combobox fixes this immediately because it's an `<Input>` that always shows whatever string it's given.

## Root cause of text clipping
The combobox `<Input>` is fixed `h-7` (28px) with `text-sm` and `w-[180px]`, single-line, no wrap → long descriptive text scrolls horizontally and the tail is hidden. We need the field to grow vertically (textarea-style) so the full text is visible after selection/edit, while still acting as the search box.

## Fix plan

### 1. Promote `DescriptiveCombobox` to a shared component
- Extract from `src/components/lims/ResultsEntry.tsx` into a new file `src/components/lims/DescriptiveCombobox.tsx`. Same props, same behavior (focus opens list, type filters, ↑/↓ navigates, Enter selects, Esc closes, Tab passes through to `onKeyDown`, click selects).
- Replace internal `<Input>` with an **auto-growing `<textarea>`** so multi-line text is fully visible:
  - `rows={1}`, `resize-none`, `overflow-hidden`, `whitespace-pre-wrap break-words`
  - `useEffect` on `value`: set `textareaRef.current.style.height = "auto"; then = scrollHeight + "px"` to grow with content
  - Min height matches current `h-7`; expands to multiple lines as text grows
  - Enter still intercepted for selection when dropdown is open and item highlighted; otherwise Enter passes to `onKeyDown` (no newline insertion — `e.preventDefault()` in the pass-through path keeps single-cell semantics)
  - Keep `data-result-input` / `data-result-value` attrs so existing Tab/Shift+Tab navigation across cells continues to work
- Re-export under same name; update import in `ResultsEntry.tsx`.

### 2. Wire into Result Verification
- `src/components/lims/ResultVerification.tsx`:
  - Import `DescriptiveCombobox`.
  - Replace the descriptive `<Select>` block at ~line 736 (desktop table) with `<DescriptiveCombobox value={currentValue} options={p.descriptiveOptions} onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)} className="!w-[180px] min-w-[180px] max-w-[180px]" />`.
  - Replace the descriptive `<Select>` block at ~line 1053 (secondary/mobile section) with the same component, `className="w-full"`.

### 3. Wire into Doctor Approval
- `src/components/lims/DoctorApproval.tsx`:
  - Import `DescriptiveCombobox`.
  - Replace the descriptive `<Select>` at ~line 573 with `<DescriptiveCombobox value={currentValue} options={p.descriptiveOptions} onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)} className="!w-[180px]" />`.

### 4. Container cells already accommodate growth
The `<TableCell>` wrappers use `py-1.5` and don't constrain row height — vertical-growing textarea will simply make the row taller, no overflow issues. No table CSS changes needed.

## Files to edit
- `src/components/lims/DescriptiveCombobox.tsx` — **new**, auto-growing textarea-based combobox.
- `src/components/lims/ResultsEntry.tsx` — remove inline component, import shared one (2 call sites unchanged).
- `src/components/lims/ResultVerification.tsx` — replace 2 descriptive `<Select>` blocks with combobox.
- `src/components/lims/DoctorApproval.tsx` — replace 1 descriptive `<Select>` block with combobox.

## Out of scope
- Numeric / qualitative inputs.
- Patient_results schema / save logic — already correct end-to-end.
- Adding new options to the master descriptive list.

## Expected outcome
- Results Entry, Result Verification, Doctor Approval all use the same searchable + editable descriptive field.
- Any descriptive value saved in Results Entry (predefined OR freely edited) shows up correctly in Verification and Approval.
- Field auto-expands vertically so the entire selected/edited text is always visible — nothing hidden under the box.
- Keyboard navigation (Tab/Shift+Tab between cells, ↑/↓/Enter/Esc inside the dropdown) works identically across all three modules.
