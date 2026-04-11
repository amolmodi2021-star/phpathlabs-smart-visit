

# Plan: Consolidate Min-Interval Check to CRM & Confirm CRM Updates on Send

## Current State
- CRM `last_sent_date` and `last_sent_type` are **already updated** after each successful send (ABC at line 757, Abnormal at line 867, Promotion at line 956). No changes needed there.
- However, the `recentSentMobiles` cooldown set is still built from `drip_campaign_log` timestamps instead of CRM. This needs to switch to CRM as the single source of truth.

## Changes

### File: `src/components/marketing/AutomatedMarketing.tsx`

**1. Remove `created_at` from drip log query (line ~302)**
Change the select back to:
```
.select("filter_id,mobile_number,contact_primary_key,cycle_number")
```

**2. Switch `recentSentMobiles` source from logs to CRM (lines 332–341)**
Replace the current drip-log-based loop with CRM-based logic:
```typescript
const intervalDate = new Date();
intervalDate.setDate(intervalDate.getDate() - minInterval);
const recentSentMobiles = new Set<string>();
for (const c of allContacts) {
  if (c.last_sent_date && new Date(c.last_sent_date) >= intervalDate) {
    const mob = (c.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (mob) recentSentMobiles.add(mob);
  }
}
```

**No other changes needed** — CRM updates on send are already implemented for all three message types.

## Summary
- **1 file modified**: `src/components/marketing/AutomatedMarketing.tsx`
- ~6 lines changed across 2 locations
- No database changes
- Single source of truth: `crm_contacts.last_sent_date`

