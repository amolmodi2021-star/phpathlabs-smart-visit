
## Stabilize Test Saving (Database-Only) and Stop “Failed to fetch” Loops

### What I found from investigation
1. **Current code is already database-only** (no test localStorage fallback remains):
   - `src/lib/tests.ts` uses direct database calls only (`getTests`, `saveTest`, `deleteTest`, `bulkInsertTests`).
2. **RLS/data-access policies are currently correct**:
   - Policies on `tests`, `estimates`, `estimate_tests`, etc. are `PERMISSIVE` for `anon` and `authenticated`.
3. **The failure is network-level from your preview session**:
   - Your captured requests show `TypeError: Failed to fetch` for `GET/POST /rest/v1/tests` before any database error body is returned.
   - In a clean browser session I tested, the same endpoints returned `200`, which means backend configuration is not the blocker right now.
4. **Impact**:
   - When this transient network failure happens, test create/read both fail, so the UI appears “broken again”.

### Implementation approach
I will harden the app so transient network failures do not feel random, while keeping data strictly in the database (no local storage caching).

### Planned code changes

#### 1) Add robust retry + timeout wrapper for test API calls
**File:** `src/lib/tests.ts`

- Add a small helper around async DB operations:
  - Retries for network errors (`Failed to fetch`) with exponential backoff (e.g., 3 attempts).
  - Request timeout guard (e.g., 10s–12s) so operations don’t hang.
  - Normalize error messages into human-readable text:
    - “Network issue connecting to backend. Please retry.”
    - vs raw technical exceptions.
- Apply wrapper to:
  - `getTests`
  - `saveTest`
  - `deleteTest`
  - `bulkInsertTests`
- Keep behavior strict:
  - **No local storage fallback**
  - Throw error if all retries fail.

#### 2) Improve Test Management UX for failure states
**File:** `src/pages/TestManagement.tsx`

- Add query error handling from `useQuery`:
  - Show clear inline error block when tests cannot load.
  - Add a **Retry** button wired to `refetch()`.
- Improve mutation toasts:
  - For failed save: explicit “Could not save to database due to network issue. Please retry.”
- Disable Save button while pending to prevent duplicate submissions.

#### 3) Tune React Query resilience for test list
**File:** `src/pages/TestManagement.tsx` (query config)

- Set query retry/backoff settings explicitly for `["tests"]`:
  - retry on network errors
  - bounded retries
  - reasonable stale/refetch behavior
- This complements the `tests.ts` retry wrapper and improves load reliability after temporary drops.

#### 4) Keep Create Estimate behavior aligned
**File:** `src/pages/CreateEstimate.tsx`

- Confirm it still reads tests from the same `getTests` path (it does now).
- After retry wrapper is added in `tests.ts`, Create Estimate automatically benefits from improved resilience when loading test options.

### Why this addresses your issue
- Your failures are currently intermittent fetch failures, not table schema/policy logic.
- Retries + timeout + clear recoverable UI give stability without violating your requirement:
  - **all data in database only**
  - **no local caching of tests**

### End-to-end verification I will run after implementation
1. Open `/tests`, create a test, confirm success toast.
2. Confirm new row appears in test list immediately.
3. Open Create Estimate, confirm same test appears in selector.
4. Trigger create estimate + share flow to ensure this path still works.
5. Confirm test record exists in backend by direct read query.
6. Re-test with temporary network interruption behavior to confirm graceful retry/error messaging.

### Technical notes
```text
Current failure pattern:
- Browser fetch fails before HTTP response -> “TypeError: Failed to fetch”
- No reliable response body -> user only sees generic toast

Planned resilience pattern:
- DB op -> retry (network-only) -> timeout -> normalized error
- UI shows actionable retry controls
- No local persistence fallback
```
