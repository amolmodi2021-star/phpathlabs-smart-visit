## Add Age/Gender badge in Outsourced section

Match the **Patient-Wise** header layout by adding the compact `Age/Gender` badge (e.g. `36/M`) next to the patient name in the **Outsourced** patient header.

### Change (single file: `src/components/lims/OutsourcedResults.tsx`)

In the patient header row (around line 1128), after the `patient_name` span, insert:

```tsx
<Badge variant="outline" className="text-[10px] font-mono">
  {formatAgeGender(reg.dob, reg.gender)}
</Badge>
```

Add the import at the top:
```ts
import { formatAgeGender } from "@/lib/ageGender";
```

### Notes
- `reg` already includes `dob` and `gender` (the registrations query uses `select("*")`), so no query changes needed.
- `Badge` is already imported in this file.
- Mirrors `ResultsEntry.tsx` line 1824 exactly for visual consistency.

### Out of scope
- No DB changes, no sort changes, no other UI changes.
