

## Fix: Tests Not Saving — Silent Database Errors

### Problem
When you save a test, it shows "Test saved" but the test never actually appears. This is because the code doesn't check if the database operation succeeded — it always assumes success.

### What Will Change

**Add proper error handling to all database operations** across these files:

1. **TestManagement.tsx** — Fix save, delete, and upload mutations to check for database errors before showing success
2. **CreateEstimate.tsx** — Fix the save mutation to throw on database errors  
3. **EstimateDashboard.tsx** — Fix delete mutation error handling
4. **HomeVisits.tsx** — Fix status update and phlebotomist assignment mutations
5. **PhlebotomistManagement.tsx** — Fix save and delete mutations
6. **MessageTemplates.tsx** — Fix template save mutation

### Technical Details

Every Supabase call returns `{ data, error }`. Currently the code ignores `error`. The fix adds error checking like:

```typescript
// BEFORE (broken - ignores errors)
await supabase.from("tests").insert(payload);

// AFTER (fixed - throws on error so mutation catches it)
const { error } = await supabase.from("tests").insert(payload);
if (error) throw error;
```

This pattern will be applied to every `supabase.from(...)` call in all mutation functions. An `onError` handler will also be added to mutations that are missing one, so errors display as toast notifications.

### Files Modified
- `src/pages/TestManagement.tsx`
- `src/pages/CreateEstimate.tsx`
- `src/pages/EstimateDashboard.tsx`
- `src/pages/HomeVisits.tsx`
- `src/pages/PhlebotomistManagement.tsx`
- `src/pages/MessageTemplates.tsx`

### After the Fix
- Failed saves will show an error message instead of "Test saved"
- Successful saves will correctly display the new test in the list
- You'll be able to see the actual error if something goes wrong

