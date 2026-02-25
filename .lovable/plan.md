

## Fix: "Failed to Fetch" — Restrictive RLS Policies Blocking All Access

### Problem
All database tables have RLS policies set to **RESTRICTIVE** mode. In the database's security model, restrictive policies can only further limit access granted by permissive policies. Since there are no permissive policies, all reads and writes are blocked — causing "TypeError: Failed to fetch" on every operation.

### Solution
Run a single database migration that drops all existing restrictive policies and recreates them as **PERMISSIVE** policies. This is a single-user app with fixed credentials, so open permissive policies are appropriate.

### Tables Affected
- tests
- estimates
- estimate_tests
- home_visits
- phlebotomists
- message_templates

### Technical Details

The migration will run this pattern for each table:

```sql
DROP POLICY IF EXISTS "Allow all on tests" ON public.tests;
CREATE POLICY "Allow all on tests" ON public.tests
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
```

The key difference is `AS PERMISSIVE` and granting to both `anon` and `authenticated` roles explicitly.

### Files Modified
- New database migration only (no code changes needed)

### After the Fix
- All database operations (read, write, update, delete) will work immediately
- Tests will save and display in Test Management
- All other modules will function correctly

