

## Add Searchable Parameter Selection to Code Mapping

Replace the simple Select dropdown with a searchable Command (combobox) component so users can quickly find parameters by typing instead of scrolling through a long list.

### Changes in `src/pages/LimsDemo.tsx`

#### 1. Add Command import
Add import for Command components alongside existing imports.

#### 2. Create searchable parameter selector
Replace the `Select` component (lines 481-495) with a `Command` combobox that includes:
- Search input field
- Filtered parameter list showing `param_code — parameter_name`
- Selection confirmation

#### 3. Keep state management
Continue using `mappingParamCode` state to track selected parameter for each unmapped result row.

### Implementation notes
- Use existing `Command`, `CommandInput`, `CommandList`, `CommandItem` from `@/components/ui/command`
- Filter `allParams` based on search query matching either `param_code` or `parameter_name`
- Show selected value in a button trigger (similar pattern to MasterLookupSelect)
- Max height for dropdown to prevent overflow

