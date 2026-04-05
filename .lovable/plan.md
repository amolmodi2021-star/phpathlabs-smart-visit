
# Phase 2 — Abnormal Tests Enhancement

## What we're building

Enhance the CRM Abnormal Tests tab with:

### 1. Per-Patient Grouped View
- Group all abnormal tests by `contact_primary_key`
- Show patient name/mobile from `crm_contacts` via join or lookup
- Expandable/collapsible rows per patient
- Select patients for bulk actions

### 2. Abnormal History Image Card
- Generate a summary image card per patient showing:
  - Patient Name, Mobile, UMR
  - Table of abnormal tests: Test Name | Date | Result | Normal Range
- Use canvas-based rendering (similar pattern to loyalty card renderer)
- Upload generated images to Supabase storage

### 3. WhatsApp Sending
- Send generated abnormal history card image via WhatsApp
- Reuse existing WhatsApp proxy settings (same as loyalty cards)
- Update `last_sent_type` to "Abnormal History" and `last_sent_date` on contact after sending
- Show send progress for bulk operations
- Log to history

### 4. Update CRM History
- Abnormal History sends should appear in the History tab alongside ABC cards

## Implementation Order
1. Rewrite `CRMAbnormalTests.tsx` with grouped view + select + send
2. Create abnormal card renderer function in `cardRenderer.ts`
3. Wire up WhatsApp sending with same proxy pattern
4. Update contact records after successful send
