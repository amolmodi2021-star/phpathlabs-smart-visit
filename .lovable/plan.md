

## Fix Test Saving Reliability

### Root Cause Found
Two compounding issues are blocking test saves:

1. **RLS Policy Type is Wrong**: The `tests` table has a RESTRICTIVE policy (`Permissive: No`). In PostgreSQL RLS, you need at least one PERMISSIVE policy to grant access. Without it, all direct SDK calls are denied silently -- even when the network works fine.

2. **Edge Function transport failures**: The browser preview intermittently cannot reach `*.supabase.co` endpoints (both `/functions/v1/` and `/rest/v1/`). When the edge function fails, the fallback to direct SDK also fails because of issue #1.

### Fix Strategy

#### Step 1: Fix RLS Policy on `tests` table (Database Migration)
- Drop the existing RESTRICTIVE policy
- Create a new PERMISSIVE policy that allows all operations for anon and authenticated roles
- This ensures direct SDK calls actually work when network is available

```sql
DROP POLICY IF EXISTS "Allow all on tests" ON public.tests;
CREATE POLICY "Allow all on tests" ON public.tests
  FOR ALL USING (true) WITH CHECK (true);
```

#### Step 2: Simplify `src/lib/tests.ts` to direct SDK only
- Remove the edge function layer entirely (it adds complexity and a second failure point)
- Use ONLY direct Supabase SDK calls (`.from("tests")`)
- Add a simple retry wrapper (2 retries with 2s delay) for network errors only
- This reduces the number of network hops from 2 (edge function attempt + fallback) to 1

#### Step 3: Update `src/pages/TestManagement.tsx`
- Remove the "Check Connection" button (unnecessary complexity)
- Keep React Query retry at 2 with 3s delay
- Keep the error state with Retry button
- Keep save button disabled while pending

### Files to Change
1. **Database migration** -- Fix RLS policy on `tests` table
2. **`src/lib/tests.ts`** -- Remove edge function calls, use direct SDK with retry
3. **`src/pages/TestManagement.tsx`** -- Simplify UI, remove connection check

### Why This Will Work
- With PERMISSIVE RLS, direct SDK calls will succeed whenever the network is available
- Removing the edge function eliminates one failure point and one network round-trip
- Retry logic handles transient "Failed to fetch" errors
- The reference app (med-estimate-text.lovable.app) uses a similar simple direct-SDK approach

### Technical Notes
```text
Current flow (2 network calls per operation):
  Browser -> Edge Function -> Database
  If fail: Browser -> REST API (blocked by RESTRICTIVE RLS)

New flow (1 network call per operation):
  Browser -> REST API (with PERMISSIVE RLS) -> Database
  If fail: retry up to 2 times with delay
```
