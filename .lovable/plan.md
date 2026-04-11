

# Plan: Create Universal Message Log Table & Log Viewer

## Overview
Create a new `message_send_log` table to track every message sent from any module. Replace the current multi-table counting in `fetchSentCount` with a single query on this table. Add a "Message Log" tab in the Marketing page with search, showing all sends in descending date order.

## Database Changes

### New table: `message_send_log`
```sql
CREATE TABLE public.message_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number text NOT NULL,
  patient_name text,
  message_type text NOT NULL,  -- 'ABC', 'Abnormal History', 'Promotion', 'Marketing', 'Loyalty', 'Estimate', 'Invoice', 'Report', 'Receipt', etc.
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on message_send_log" ON public.message_send_log FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_message_send_log_sent_at ON public.message_send_log(sent_at DESC);
CREATE INDEX idx_message_send_log_mobile ON public.message_send_log(mobile_number);
```

## Code Changes

### 1. Create helper: `src/lib/messageLog.ts`
A small utility function `logMessageSend(mobile, name, type)` that inserts into `message_send_log`. All modules will call this after a successful send.

### 2. Add logging calls to all send points (~13 locations)

**API-based sends (via edge functions):**
- `AutomatedMarketing.tsx` — after successful ABC send (~line 820), Abnormal send (~line 930), Promotion send (~line 1020)
- `MarketingSender.tsx` — after successful send (~line 152)
- `LoyaltyCardHistory.tsx` — after successful loyalty send

**Browser-based sends (shareOnWhatsApp):**
- `CreateEstimate.tsx`, `EditEstimateDialog.tsx`, `EstimateDashboard.tsx` — estimate shares
- `AddHomeVisitDialog.tsx`, `EditHomeVisitDialog.tsx` — visit confirmations
- `InvoicePreview.tsx` — invoice shares
- `ViewReport.tsx` — report shares
- `PaymentDetailsDialog.tsx`, `ReceiptViewDialog.tsx` — receipt shares
- `AbnormalHistory.tsx`, `useAbnormalHistory.ts` — abnormal history sends
- `DirectAI.tsx` — AI report sends

Each location: add `logMessageSend(mobile, patientName, "TypeName")` right after the successful send.

### 3. Update `fetchSentCount` in `AutomatedMarketing.tsx`
Replace the 4-table query (lines 120-127) with a single count from `message_send_log`:
```typescript
const res = await supabase.from("message_send_log")
  .select("id", { count: "exact", head: true })
  .gte("sent_at", since);
const total = res.count || 0;
```
This eliminates the double-counting issue entirely.

### 4. Create `src/components/marketing/MessageLog.tsx`
A new tab component showing all logged messages:
- Search bar filtering by patient name, mobile number, or message type
- Table columns: #, Patient Name, Mobile Number, Message Type, Sent Date (dd-MM-yyyy), Sent Time (hh:mm AM/PM)
- No grouping — duplicates shown as separate rows
- Sorted descending by `sent_at`
- Paginated fetch (batched like CRMSentHistory)

### 5. Update `src/pages/Marketing.tsx`
Add a third tab "Message Log" alongside "Send Messages" and "Automated".

## Summary
- **1 new table**: `message_send_log`
- **1 new file**: `src/lib/messageLog.ts`
- **1 new component**: `src/components/marketing/MessageLog.tsx`
- **~15 files modified**: add log calls at each send point + update Marketing page + fix fetchSentCount
- Fixes double-counting by using a single source of truth
- All sends tracked with duplicates preserved

