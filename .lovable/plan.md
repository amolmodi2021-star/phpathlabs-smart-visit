

## Goal
Make every large list in the app safe at 10×–100× the current data volume by adding **server-side pagination** and the right **DB indexes** — without touching any business logic, formulas, or UI behavior.

## Current state (from DB inspection)
| Table | Live rows | Today's risk |
|---|---|---|
| `crm_abnormal_tests` | 53,886 | Already paginated via RPC ✅ |
| `crm_contacts` | 35,259 | Already paginated via RPC ✅ |
| `message_send_log` | 10,658 | **Unbounded fetches** in MessageLog/MarketingHistory ❌ |
| `abnormal_history` | 9,711 | **Full-table fetch** in AbnormalHistory page ❌ |
| `drip_campaign_log` | 3,229 | Loaded fully in MarketingHistory ❌ |
| `estimate_tests` | 2,156 | Joined unbounded ❌ |
| `estimates` | 675 | Full fetch in EstimateDashboard ❌ (will explode) |
| `home_visits` | 406 (Completed/Reg) | Full fetch in CompletedHomeVisits ❌ + HomeVisits ❌ |
| `patient_registrations` | already RPC-paginated ✅ |
| `sample_tubes` | 14-day window + limit 500 ✅ |

Already-paginated modules (Dispatch, RegisteredPatients, DuePayments, BadDebts, DailyReport via date filters, CRM Contacts, WhatsApp Chat) are kept as-is.

## Scope (what changes)

### A. Add server-side pagination to these list views
For each: 50 rows/page, debounced search (already in place), prev/next + page indicator using the existing `Pagination` ui component.

1. **`src/components/lims/CompletedHomeVisits.tsx`**
   - Use `.range(from, to)` on `home_visits` filtered by status; fetch a separate count via `head:true` for the page indicator.
   - Keep the `expandedRow`, search, register, edit dialogs untouched.

2. **`src/pages/HomeVisits.tsx`** (active visits dashboard)
   - Same pattern; tabs (Today / Upcoming / Cancelled / etc.) each paginate independently.

3. **`src/pages/EstimateDashboard.tsx`**
   - Replace `select("*, estimate_tests(*)")` full-table fetch with paged `estimates` + lazy-load tests for visible rows only.

4. **`src/pages/AbnormalHistory.tsx`**
   - Page through `abnormal_history` ordered by `created_at desc`; counts already come from the RPC `get_abnormal_history_counts`.

5. **`src/components/marketing/MessageLog.tsx`** and **`src/components/marketing/MarketingHistory.tsx`**
   - Server-side paginate `message_send_log` / `drip_campaign_log` ordered by `sent_at desc` / `created_at desc`. Keep filters; push them into the query.

6. **`src/components/lims/ModifiedApproval.tsx`**
   - Paginate `approved_reports` ordered by `approval_date desc`. Search via existing `.or()` filter — keep it.

7. **`src/components/crm/CRMSentHistory.tsx`**
   - Replace the manual 900-row chunked loop with a single page-of-50 query + count, ordered by `last_sent_date desc`.

8. **`src/pages/ReportsDashboard.tsx`**
   - Already capped at 200; convert to true 50/page pagination on `uploaded_reports`.

9. **`src/pages/PhleboDashboard.tsx`** (if it fetches all visits) — paginate same way.

### B. Add the missing DB indexes (one migration)
All `CREATE INDEX IF NOT EXISTS` so they're safe to re-run. None alter schema beyond indexing.

```sql
-- home_visits: tab queries by status + date
CREATE INDEX IF NOT EXISTS idx_home_visits_status_date
  ON home_visits (status, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_home_visits_estimate_id
  ON home_visits (estimate_id);
CREATE INDEX IF NOT EXISTS idx_home_visits_phlebotomist
  ON home_visits (phlebotomist_id, visit_date);

-- estimates: dashboard order + lookups
CREATE INDEX IF NOT EXISTS idx_estimates_created_at
  ON estimates (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_whatsapp_number
  ON estimates (whatsapp_number);

-- estimate_tests: join lookup
CREATE INDEX IF NOT EXISTS idx_estimate_tests_estimate_id
  ON estimate_tests (estimate_id);

-- abnormal_history: list order + sent filter
CREATE INDEX IF NOT EXISTS idx_abnormal_history_created_at
  ON abnormal_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abnormal_history_sent
  ON abnormal_history (sent, created_at DESC);

-- drip_campaign_log: history listing
CREATE INDEX IF NOT EXISTS idx_drip_campaign_log_created_at
  ON drip_campaign_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drip_campaign_log_filter
  ON drip_campaign_log (filter_id, created_at DESC);

-- message_send_log: search by type/date already partial; add type filter
CREATE INDEX IF NOT EXISTS idx_message_send_log_type_sent
  ON message_send_log (message_type, sent_at DESC);

-- approved_reports: order by approval_date for ModifiedApproval
CREATE INDEX IF NOT EXISTS idx_approved_reports_approval_date
  ON approved_reports (approval_date DESC);
CREATE INDEX IF NOT EXISTS idx_approved_reports_patient_name_trgm
  ON approved_reports USING gin (patient_name gin_trgm_ops);

-- patient_registrations: home_visit_id already indexed ✅, add home visit lookup composite
CREATE INDEX IF NOT EXISTS idx_pr_home_visit_status
  ON patient_registrations (home_visit_id, status);

-- payment_transactions: daily report order
CREATE INDEX IF NOT EXISTS idx_pt_created_at
  ON payment_transactions (created_at DESC);

-- crm_abnormal_tests: contact + name listing
CREATE INDEX IF NOT EXISTS idx_crm_abnormal_tests_contact_name
  ON crm_abnormal_tests (contact_primary_key, test_name);
```

### C. Reusable pagination helper
Add `src/components/ui/PaginatedTableFooter.tsx` — a small component wrapping the existing `Pagination` primitives so every paginated list uses identical UI (Page X of Y, Prev/Next, "Showing 1–50 of 1,234").

## Implementation sketch (one component, applied identically to all)

```tsx
const PAGE_SIZE = 50;
const [page, setPage] = useState(0);
useEffect(() => setPage(0), [debouncedSearch]); // reset on search change

const { data, isLoading } = useQuery({
  queryKey: ["completed_home_visits", debouncedSearch, page],
  queryFn: async () => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let q = supabase.from("home_visits")
      .select("*, estimates!inner(*)", { count: "exact" })
      .in("status", ["Completed","Registered"])
      .order("visit_date", { ascending: false })
      .range(from, to);
    if (debouncedSearch) {
      q = q.or(
        `patient_name.ilike.%${debouncedSearch}%,whatsapp_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`,
        { foreignTable: "estimates" }
      );
    }
    const { data, count, error } = await q;
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  },
  placeholderData: (prev) => prev, // smooth page transitions
});
```

## What stays untouched
- All registration / collection / verification / approval / dispatch business logic.
- Discount, payment-split, audit-trail, signature, drip-engine rules.
- Existing RPC-paginated modules (CRM Contacts, WhatsApp Chat, RegisteredPatients, Dispatch).
- Realtime subscriptions — they keep invalidating the same query keys; pagination piggy-backs.

## Out of scope
- No data migration / no row mutations.
- No schema column changes.
- No edge-function changes.
- No restyling.

## Expected outcome
- Each large list loads in O(50) rows regardless of total table size.
- DB queries hit the new indexes (verified by `EXPLAIN`) — sub-100ms even at 1M rows.
- Search remains debounced (400ms) and resets to page 0.
- Zero functional or visual regressions; UI just gains a prev/next + page-of-N footer.

