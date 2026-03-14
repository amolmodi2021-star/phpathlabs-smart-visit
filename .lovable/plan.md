

## Live Sync / Auto-Refresh for All Tabs

### What This Does
When data changes on one device (e.g., a new home visit is added, a test is updated, an estimate is created), all other devices viewing the app will automatically refresh and show the updated data -- no manual refresh needed.

### Implementation Steps

**Step 1: Database Migration -- Enable Realtime**

Add all 7 core tables to the realtime publication so the database broadcasts changes:
- `home_visits`
- `estimates`
- `estimate_tests`
- `tests`
- `phlebotomists`
- `message_templates`
- `abnormal_history`

**Step 2: Create a Reusable Realtime Hook**

Create a new hook `src/hooks/useRealtimeSync.ts` that:
- Subscribes to Postgres changes on a given table
- On any INSERT, UPDATE, or DELETE event, automatically invalidates the matching React Query cache keys
- Cleans up the subscription when the component unmounts

**Step 3: Wire Up Each Page**

Add the realtime hook to each page/component so queries auto-refresh:

| Page | Table(s) Listened | Query Keys Invalidated |
|------|-------------------|----------------------|
| HomeVisits | `home_visits` | `home_visits` |
| CreateEstimate | `tests` | `tests` |
| EstimateDashboard | `estimates`, `estimate_tests` | `estimates` |
| TestManagement | `tests` | `tests` |
| PhlebotomistManagement | `phlebotomists` | `phlebotomists` |
| MessageTemplates | `message_templates` | `message_templates` |
| AbnormalHistory | `abnormal_history` | `abnormal_history`, `abnormal_history_counts` |

### Technical Details

The reusable hook will look like:

```text
useRealtimeSync(tableName, queryKeysToInvalidate[])
```

It subscribes to `postgres_changes` on the specified table and calls `queryClient.invalidateQueries()` for each key whenever a change is detected. This triggers a fresh fetch from the database automatically.

### Files to Create/Modify

1. **New migration** -- SQL to add tables to `supabase_realtime` publication
2. **New file**: `src/hooks/useRealtimeSync.ts` -- reusable realtime subscription hook
3. **Modified**: `src/pages/HomeVisits.tsx` -- add `useRealtimeSync("home_visits", ...)`
4. **Modified**: `src/pages/CreateEstimate.tsx` -- add `useRealtimeSync("tests", ...)`
5. **Modified**: `src/pages/EstimateDashboard.tsx` -- add `useRealtimeSync("estimates", ...)` and `useRealtimeSync("estimate_tests", ...)`
6. **Modified**: `src/pages/TestManagement.tsx` -- add `useRealtimeSync("tests", ...)`
7. **Modified**: `src/pages/PhlebotomistManagement.tsx` -- add `useRealtimeSync("phlebotomists", ...)`
8. **Modified**: `src/pages/MessageTemplates.tsx` -- add `useRealtimeSync("message_templates", ...)`
9. **Modified**: `src/pages/AbnormalHistory.tsx` -- add `useRealtimeSync("abnormal_history", ...)`

This is included in your Lovable Cloud usage and should be well within the free tier for a small team.

