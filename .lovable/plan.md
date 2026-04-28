## Root Cause (last 24-48 h)

Checked `pg_stat_statements` and write counts. Cost is NOT from new patient activity (~30 patients, ~900 result rows today — tiny). It's from **two leaks still active**:

### Leak 1 — `crm_contacts` (729K query calls, 9.2M ms cumulative)
Despite deleting CRM data, the table is still being **read constantly** by:
- `get_wa_chat_messages` & `get_wa_contacts_paginated` RPCs (called every WhatsApp Chat open + realtime tick) — they JOIN `crm_contacts` for name resolution.
- `dripCardSenders.ts`, `syncPatientDemographics.ts`, `cleanup_blacklisted_contacts`, `cleanup_non_phpl_*`.
- `useRealtimeSync` still listed `crm_*` references in some hooks.
- The CRM page route is still mounted.

Even with 0 rows, every call still does a planning round-trip + parses the SQL.

### Leak 2 — Realtime WAL decode on `patient_results` (and other high-churn tables)
Top query in `pg_stat_statements`: Supabase Realtime's WAL-to-JSON decoder ran **8.9M times for 47M ms** of CPU. Every `INSERT/UPDATE` on a table in the `supabase_realtime` publication fires this decoder, then fans out to every connected browser tab. Today alone, `patient_results` saw **915 writes** — each one triggers WAL decode + N tab broadcasts. As volume grows to thousands/day, this scales linearly into a major CPU bill.

`patient_results` is in the realtime publication, but the LIMS UI already polls and uses targeted invalidation via `propagateRegistrationChange` — the realtime subscription is **redundant**.

---

## Fix Plan

### A. Completely disable CRM (single migration + code stubs)

**Database (migration):**
1. Drop unused RPCs that read `crm_contacts`:
   - `get_crm_contacts_paginated`, `get_crm_contacts_count`, `get_drip_contact_slice`, `get_abnormal_pks`, `get_abnormal_patients`, `get_abnormal_patients_count`, `cleanup_blacklisted_contacts`, `cleanup_non_phpl_duplicates`, `cleanup_non_phpl_mobile_duplicates`.
2. Replace `get_wa_chat_messages` and `get_wa_contacts_paginated` with **simpler versions that no longer JOIN `crm_contacts`** (use `webhook_messages.sender_name` and `estimates.patient_name` only for name resolution). This single change kills the bulk of the 729K-call hot path.
3. Remove `crm_contacts`, `crm_abnormal_tests`, `crm_blacklist`, `crm_import_staging`, `crm_sequence_rules` from the realtime publication if present.

**Frontend:**
1. Remove `/crm` route from `src/App.tsx`.
2. Remove the CRM nav link from `src/components/AppLayout.tsx`.
3. Stub `src/components/crm/CRMSequences.tsx`, `src/components/marketing/AutomatedMarketing.tsx`, `src/lib/dripCardSenders.ts`, `src/lib/syncPatientDemographics.ts` — replace bodies with no-op exports so any lingering imports don't fire queries.
4. Remove `crm_*` references from `useRealtimeSync` table type union.

**Note:** We're not dropping the CRM tables themselves (just 12 MB, no cost) — only stopping all reads. If you want them dropped later, easy follow-up.

### B. Patient_results — the long-term fix

This is the table that will dominate volume as you scale. Two surgical changes:

1. **Remove `patient_results` from `supabase_realtime` publication.**
   ```sql
   ALTER PUBLICATION supabase_realtime DROP TABLE public.patient_results;
   ```
   - Why safe: every place that writes patient_results already calls `propagateRegistrationChange` from `src/lib/limsPropagation.ts`, which invalidates the right React Query keys in the actor's tab. Other open tabs will refetch on focus (we already have `staleTime: 60s`, no `refetchOnWindowFocus`).
   - Today's effect: ~915 WAL events × N tabs eliminated. At 10× scale: 10,000+ events eliminated.
   - Trade-off: a second technician's tab won't see live updates from another tab's edit until they refocus. Acceptable per current workflow (results entry is single-operator at a time).

2. **Add a composite index for the hot read path** (Result Verification, Doctor Approval, Modified Approval all filter by registration + status):
   ```sql
   CREATE INDEX IF NOT EXISTS idx_patient_results_reg_status
     ON public.patient_results (registration_id, status);
   CREATE INDEX IF NOT EXISTS idx_patient_results_updated
     ON public.patient_results (updated_at DESC);
   ```
   - Cuts the per-query CPU as the table grows from thousands → millions of rows.

3. **Trim same-day duplicate writes.** In `src/components/lims/ResultsEntry.tsx`, results are saved on every blur/Tab. Add a 1-second debounce per parameter so rapid typing doesn't fire 5 UPDATEs per cell. (One-line change wrapping the existing save.)

4. **Also drop these from the realtime publication** (same reasoning — already covered by `propagateRegistrationChange` or polling): `sample_tubes`, `lims_test_orders`, `outsourced_test_snips`, `webhook_messages`, `estimate_tests`, `phlebotomists`, `phlebotomist_leaves`.
   **Keep on realtime** (cross-tab UX matters): `patient_registrations`, `home_visits`, `tests`, `app_settings`, `message_templates`, `estimates`.

---

## Files Changed

```text
supabase/migrations/<new>.sql        — drop CRM RPCs, simplify WA RPCs, trim publication, add patient_results indexes
src/App.tsx                          — remove /crm route + import
src/components/AppLayout.tsx         — remove CRM nav link
src/pages/CRM.tsx                    — replace with disabled stub
src/components/crm/CRMSequences.tsx  — stub
src/components/marketing/AutomatedMarketing.tsx — stub
src/lib/dripCardSenders.ts           — short-circuit all senders
src/lib/syncPatientDemographics.ts   — no-op
src/hooks/useRealtimeSync.ts         — remove abnormal_history/patient_results/sample_tubes/etc. from union type
src/components/lims/ResultsEntry.tsx — debounce parameter save
```

No new tables. No tables dropped. LIMS, registration, dispatch, results entry, dashboards remain fully functional.

---

## Expected Impact

| Cost Source                          | Before (cumulative)  | After                |
|--------------------------------------|----------------------|----------------------|
| Realtime WAL decode (top query)      | 8.9M calls / 47M ms  | ~1M calls / 5M ms (−85%) |
| `crm_contacts` reads via WA RPCs     | 729K calls / 9.2M ms | ~0                   |
| `patient_results` realtime fan-out   | 915 events/day × tabs| 0                    |
| `patient_results` query plan cost    | seq-friendly         | indexed (10× faster as it grows) |
| `drip_*`, `abnormal_*` reads         | 244K calls           | 0                    |

**Approve and I'll implement in one pass.**