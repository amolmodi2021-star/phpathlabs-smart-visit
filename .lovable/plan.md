

# Plan: Add message_send_log Check to Drip Engine Min-Interval Filter

## Problem
The drip engine only checks `crm_contacts.last_sent_date` for the cooling-down period. Messages sent from other modules (estimates, loyalty cards, LIMS, etc.) are logged in `message_send_log` but not considered. Since `message_send_log` allows duplicates, we must use the **latest** `sent_at` per mobile number.

## Changes

### File: `src/components/marketing/AutomatedMarketing.tsx`

**1. Add a 6th parallel fetch (~line 294)**

Add to the `Promise.all` block:
```typescript
fetchAll(supabase.from("message_send_log")
  .select("mobile_number,sent_at")
  .gte("sent_at", intervalDate.toISOString()))
```

Note: `intervalDate` must be computed before the Promise.all block (move lines 332-333 above line 294).

**2. Merge into recentSentMobiles (~line 334-340)**

After building `recentSentMobiles` from CRM contacts, iterate message log results, normalize each mobile to 10 digits, and add to `recentSentMobiles`. Since there are duplicates, any entry within the interval window means the mobile should be skipped — no need to find the max date, just the existence of any log entry within the window is sufficient (the `.gte` filter already handles this).

```typescript
for (const log of recentLogEntries) {
  const mob = (log.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (mob && mob.length === 10) recentSentMobiles.add(mob);
}
```

This automatically makes all existing min-interval checks (initial collection, backfill loop) respect message_send_log data.

## Single file modified
- `src/components/marketing/AutomatedMarketing.tsx`

