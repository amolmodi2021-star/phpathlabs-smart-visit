

# Plan: Complete Message Logging Coverage + New Numbers Tab

## Problem
Several send points are missing `logMessageSend` calls:
- **CRMContacts.tsx** — bulk ABC sends (no logging)
- **CRMAbnormalTests.tsx** — single + bulk Abnormal History sends (no logging)
- **CRMImportReview.tsx** — import review ABC sends (no logging)
- **send-loyalty-whatsapp** edge function — Loyalty Card sends (no logging)

Also: MessageLog.tsx has a duplicate Sent Time column (line 107).

## Changes

### 1. Add logging to CRM send points (3 files)

**CRMContacts.tsx** (~line 800): After successful send, add:
```typescript
await logMessageSend(destMob, r.patient_name, "ABC", r.umr_number, r.primary_key);
```

**CRMAbnormalTests.tsx** (~line 660 single send + ~line 783 bulk send): After successful sends, add:
```typescript
await logMessageSend(normalizedMobile, group.patientName, "Abnormal History", group.umrNumber, group.primaryKey);
```

**CRMImportReview.tsx** (~line 319): After successful send, add:
```typescript
await logMessageSend(mobile10, r.patient_name, "ABC", r.umr_number, r.primary_key);
```

### 2. Add logging to Loyalty Card edge function

Update `supabase/functions/send-loyalty-whatsapp/index.ts` to insert into `message_send_log` for each successfully sent card, with message_type "Loyalty Card".

### 3. Fix duplicate column in MessageLog.tsx

Remove the extra `<TableCell>` on line 107.

### 4. Add "New Numbers" tab

Add a new tab in `src/pages/Marketing.tsx` called "New Numbers" that shows mobile numbers from `message_send_log` that do NOT exist in `crm_contacts`. This will be a new component `src/components/marketing/NewNumbers.tsx` with:
- Query: select distinct mobile numbers from `message_send_log` where mobile_number NOT IN (select mobile_number from crm_contacts)
- Table: Mobile Number, Patient Name (from last log entry), Last Message Type, Last Sent Date, count of messages sent
- Search bar

## Files Modified
- `src/components/crm/CRMContacts.tsx` — add logMessageSend import + call
- `src/components/crm/CRMAbnormalTests.tsx` — add logMessageSend import + 2 calls
- `src/components/crm/CRMImportReview.tsx` — add logMessageSend import + call
- `supabase/functions/send-loyalty-whatsapp/index.ts` — add server-side logging
- `src/components/marketing/MessageLog.tsx` — fix duplicate column
- `src/components/marketing/NewNumbers.tsx` — new component
- `src/pages/Marketing.tsx` — add New Numbers tab

