

# Cost-driver fixes — manual-refresh model, lean logging, and tighter realtime

## What you're approving in one line

Strip auto-polling and verbose payloads everywhere; surface a **Refresh** button next to every counter/log; pause realtime fan-out during sends; tighten `message_send_log` to 30-day retention with type-only metadata.

---

## Fix 1 — `MessageLog` tab: refresh button + 100 row hard cap

**File:** `src/components/marketing/MessageLog.tsx`

- `PAGE_SIZE` 50 → **100**, hard-cap at one page (no pagination beyond the latest 100). The existing search box still works against the latest 100 only; for older searches the user can use the date filter (already in DB).
- Remove `count: "exact"` from the query (saves a full-table count on every load).
- Add a **Refresh** icon button next to the search box that calls `refetch()`. Query is `staleTime: Infinity, refetchOnMount: false` so the only way to fetch is the button.
- Drop the `delivered_at`/`read_at` columns? **No** — kept, they're already on the row.

## Fix 2 — Marketing pending counters: refresh button, no auto-refetch

**File:** `src/components/marketing/AutomatedMarketing.tsx`

- Remove `refetchInterval: 120000` from the `drip-pending-counts` query (line 269).
- Set `staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false`.
- Add a small **Refresh** button next to the "Pending ABC / Pending Abnormal" badges that calls `qc.invalidateQueries({ queryKey: ["drip-pending-counts"] })`.

## Fix 3 — `drip_campaign_log` query trimmed

**File:** `src/components/marketing/AutomatedMarketing.tsx` (line 252-263)

- `.select("*")` → `.select("id, status, message_type, mobile_number, contact_primary_key, filter_id, filter_name, cycle_number, skip_reason, created_at")`
- `.limit(10000)` → `.limit(500)`
- Add `staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false` and a **Refresh** button on the diagnostic log card.

## Fix 4 — 24-hour usage counter: button only

**File:** `src/components/marketing/AutomatedMarketing.tsx` (line 198-202)

- Delete the `setInterval(fetchSentCount, 60000)` entirely.
- Keep the initial fetch on mount.
- Add a **Refresh** button next to the "X / Y in last 24h" indicator that calls `fetchSentCount()`.

## Fix 5 — `message_send_log` slimmed to type-only, 30-day retention

**Code changes:**

| File | Change |
|---|---|
| `src/lib/messageLog.ts` | Drop `messageContent` and `retryPayload` from the insert. Always insert `message_content: null`, `retry_payload: null`. Signature kept for compatibility. |
| `src/pages/WhatsAppChat.tsx` (line 414) | Remove `message_content: msgContent` from the `message_send_log` insert. (The `webhook_messages` row keeps the body for chat-history rendering — chat UI reads from `webhook_messages`, not `message_send_log`, so chat history is unaffected.) |
| `src/components/lims/BillingDashboard.tsx` (line 103) | Remove `message_content: msg`. |

**Edge function change:**

`supabase/functions/prune-old-logs/index.ts` — change `message_send_log` retention from **180 → 30 days**.

**Trade-off you must accept (one-time, irreversible per row):** the **Marketing Retry** tab today re-sends Promotion/Marketing-template messages from `retry_payload`. Once we stop writing payloads:
- **ABC + Abnormal History retries:** unaffected (regenerated fresh from CRM).
- **Promotion + Marketing-template retries:** no longer possible — failed rows show in the Retry tab as "no payload, cannot retry" (UI already handles this case via `missingPayloadCount`).

Practically you'd just re-run the Marketing campaign instead of using Retry for those two types. Confirm by approving.

## Fix 6 — `LimsDemo` migrated to `useRealtimeSync`

**File:** `src/pages/LimsDemo.tsx` (lines 116-141)

Replace the 5 hand-rolled `supabase.channel(...).subscribe()` blocks with:

```ts
useRealtimeSync("lims_test_orders", ["lims-orders"]);
useRealtimeSync("lims_test_results", ["lims-results", "lims-orders"]);
useRealtimeSync("lims_interface_logs", ["lims-logs"]);
useRealtimeSync("lims_unmapped_results", ["lims-unmapped"]);
useRealtimeSync("lims_no_map_required", ["lims-no-map-required", "lims-unmapped"]);
```

(Adds the missing tables to the `TableName` union in `useRealtimeSync.ts`.) Once the new `enabled` flag exists (Fix 1-bonus), all five honor it.

## Fix 1-bonus — `useRealtimeSync` accepts `{ enabled }`

**File:** `src/hooks/useRealtimeSync.ts`

Add optional 4th arg `{ enabled = true }`. When `false`, skip channel subscription. Apply at the `AutomatedMarketing` call site:

```ts
useRealtimeSync("message_send_log", ["drip-pending-counts", "wa-usage-24h"], 400, { enabled: !sending });
```

Eliminates the realtime broadcast wave during 2,000-card campaigns.

## Fix 7 — Global React Query defaults

**File:** `src/App.tsx` (line 37)

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
```

Cuts duplicate reads on tab-switch / network blip across the entire app.

## Fix 8 — Permanently unschedule `cleanup-card-images-midnight`

New migration:

```sql
SELECT cron.unschedule('cleanup-card-images-midnight');
```

Wrapped in a `DO` block so it's idempotent if the job no longer exists.

---

## Re-verification — anything else escalating costs?

I scanned every realtime channel, every `setInterval`, every `refetchInterval`, every `select("*")` on tables >1K rows, every edge function trigger, and every cron. Three more findings worth flagging (small, want your call before applying):

| Item | Cost impact | Recommended action |
|---|---|---|
| `PatientReportPortal.tsx` heartbeats every 60s while a patient has the report open | Tiny per session, but unbounded if many patients view simultaneously | Bump to 120s and skip when `document.hidden` (already partially done). **Will apply silently with Fix 7 since it's a small tweak.** |
| `lims_interface_logs` keeps 90 days × verbose JSON request/response bodies | Medium DB growth on busy days | Tighten retention to **30 days** in `prune-old-logs` (matches the new `message_send_log` rule). **Will apply.** |
| `webhook_messages` retention 90 days | Low (table is only 672 KB today) | Leave as-is. Chat history is the only audit trail for inbound WhatsApp. |

No other always-on subscriptions, no other per-minute polls, no other oversized selects.

---

## Files changing

| File | Change |
|---|---|
| `src/hooks/useRealtimeSync.ts` | Add `{ enabled }` option; extend `TableName` union with 5 LIMS tables |
| `src/components/marketing/AutomatedMarketing.tsx` | Remove 60s + 120s intervals; add 3 refresh buttons; trim drip-log query; pass `enabled: !sending` |
| `src/components/marketing/MessageLog.tsx` | 100-row cap, no-count, refresh button, no auto-refetch |
| `src/pages/LimsDemo.tsx` | Replace 5 hand-rolled channels with `useRealtimeSync` calls |
| `src/lib/messageLog.ts` | Stop writing `message_content` + `retry_payload` |
| `src/pages/WhatsAppChat.tsx` | Drop `message_content` from `message_send_log` insert (chat UI reads `webhook_messages`) |
| `src/components/lims/BillingDashboard.tsx` | Drop `message_content` from log insert |
| `src/App.tsx` | Add React Query global defaults |
| `src/pages/PatientReportPortal.tsx` | Heartbeat 60s → 120s, skip when hidden |
| `supabase/functions/prune-old-logs/index.ts` | `message_send_log` 180→30 days; `lims_interface_logs` 90→30 days |
| New migration | `cron.unschedule('cleanup-card-images-midnight')` |

## Expected outcome

- **Idle Marketing tab:** zero background queries (was ~30 MB / 2 min).
- **Active campaign:** zero realtime broadcasts (was 1 per send).
- **Daily `message_send_log` growth:** ~25 MB → ~2 MB (just metadata).
- **Tab-switching:** no refetch storms.
- **Daily Cloud usage on heavy-send days:** $4–5 (pre-Cloudinary) → $1 (after Cloudinary) → **$0.10–$0.30** (after these fixes).

## Verification plan

1. Open Marketing tab, leave for 10 min — DevTools → Network shows zero queries until you click Refresh.
2. Run a 200-card campaign — DevTools → Network → WS shows zero realtime frames during the run, one settle frame at end.
3. Open `MessageLog` — see exactly 100 rows, no count badge load delay, Refresh icon visible.
4. Send a chat message in `WhatsAppChat` — message appears in chat history (proves `webhook_messages` is the source of truth).
5. Trigger a Promotion failure — Retry tab shows it as "missing payload" (expected with new behavior).
6. Wait 24h, check Cloud usage page — daily delta should be in cents.

