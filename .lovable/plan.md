

# Automated Marketing / Drip Campaign Module — Revised Plan

## Overview

Build an **Automated Marketing** tab in the Marketing section that lets you create saved "campaign filters" against CRM contacts data, with built-in deduplication by mobile number, minimum send intervals, daily message limits, sequencing, and **data completeness validation** before claiming a mobile number for any filter.

## How It Works (User Perspective)

```text
┌─────────────────────────────────────────────────────┐
│  AUTOMATED MARKETING                                │
├─────────────────────────────────────────────────────┤
│  Global Settings:                                   │
│  ┌──────────────────────────────────────────┐       │
│  │ Max Messages/Day: [200]                  │       │
│  │ Min Interval (days): [3]                 │       │
│  │ Exclude Blacklist: [✓ ON by default]     │       │
│  └──────────────────────────────────────────┘       │
│                                                     │
│  Saved Campaign Filters:                            │
│  ┌──────────────────────────────────────────────┐   │
│  │ Name │ Type     │ Priority │ Enabled │ Action│   │
│  │──────┼──────────┼──────────┼─────────┼───────│   │
│  │ F1   │ ABC Card │ 1        │ ✓       │ ✎ ✕  │   │
│  │ F2   │ Abnormal │ 2        │ ✓       │ ✎ ✕  │   │
│  │ F3   │ Promo    │ 3        │ ✓       │ ✎ ✕  │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [+ Add Filter]                                     │
│  [Preview Eligible Records]  [Send Messages]        │
│                                                     │
│  Execution Log (with skip reasons):                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ Date │ Filter │ Sent │ Skipped │ Reason      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Core Logic — Deduplication, Sequencing & Data Validation

1. **Each filter** defines: message type (ABC/Abnormal/Promotion), location filter, last_sent_type filter (sequencing), record limit, priority order
2. **On "Send"**: collect eligible contacts per filter, then **deduplicate by mobile across all filters** — a mobile claimed by Filter 1 is excluded from Filter 2/3
3. **Min interval check**: any mobile that received ANY message within last N days is skipped
4. **Daily limit**: total messages capped, divided equally among active filters
5. **Priority**: filters processed in priority order; higher priority claims the mobile first

### Data Completeness Validation (New)

Before claiming a mobile number for a filter, validate that the record has the data needed to generate a non-blank card:

- **ABC Card filters**: Skip records where `umr_number` is blank/null. Log skip reason as `missing_umr`.
- **Abnormal History Card filters**: Query `crm_abnormal_tests` for that contact's `primary_key`. Skip if zero test records exist. Log skip reason as `no_abnormal_history`.
- **Promotion filters**: No additional validation (text-only template).

This prevents sending blank or incomplete cards to patients.

## Database Changes

### New table: `drip_campaign_filters`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| name | text | Filter name |
| message_type | text | 'abc_card', 'abnormal_card', 'promotion' |
| priority | integer | Lower = higher priority |
| location_filter | text | 'ALL', 'PH VESU', 'NON PHPL' |
| last_sent_type_filter | text | Sequencing: pick contacts whose last_sent_type matches |
| last_sent_days_ago | integer | Only contacts not sent in X+ days |
| record_limit | integer | Max records this filter can pick |
| template_id | uuid | Marketing template for promotions |
| enabled | boolean | default true |
| created_at | timestamptz | |

### New table: `drip_campaign_log`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| filter_id | uuid FK | Which filter |
| filter_name | text | Snapshot |
| message_type | text | What was sent |
| mobile_number | text | 10-digit |
| patient_name | text | |
| contact_primary_key | text | |
| status | text | 'sent', 'failed', 'skipped' |
| skip_reason | text | 'blacklisted', 'interval', 'duplicate', 'missing_umr', 'no_abnormal_history' |
| created_at | timestamptz | |

### Global settings in `app_settings`
- `drip_max_messages_per_day` (default 200)
- `drip_min_interval_days` (default 3)
- `drip_exclude_blacklist` (default 'true')

## Implementation Steps

### 1. Database migration
Create the two new tables with permissive RLS policies.

### 2. New component: `AutomatedMarketing.tsx`
- **Global Settings**: max messages/day, min interval, exclude blacklist toggle
- **Filter CRUD**: add/edit/delete with all fields
- **Preview**: runs dedup + validation logic, shows eligible count per filter with skip breakdown
- **Send execution**:
  1. Fetch enabled filters by priority
  2. For each filter, query `crm_contacts` matching criteria
  3. Exclude blacklisted mobiles
  4. Exclude mobiles sent within min_interval_days
  5. **ABC cards**: skip records with blank `umr_number`
  6. **Abnormal cards**: skip records with zero entries in `crm_abnormal_tests`
  7. Deduplicate: "claimed mobiles" set across filters
  8. Cap at `daily_limit / active_filter_count`
  9. Generate and send cards via existing renderers + WhatsApp proxy
  10. Log every action to `drip_campaign_log` with skip reasons
  11. Update `crm_contacts.last_sent_type` and `last_sent_date`
- **Execution log**: recent entries grouped by date with skip reason breakdown

### 3. Add tab to Marketing page
Add "Automated" tab in `Marketing.tsx`.

### 4. Reuse existing card generation
- ABC cards: `cardRenderer.ts` + WhatsApp proxy
- Abnormal cards: `CRMAbnormalTests.tsx` generation logic
- Promotions: `send-marketing-message` edge function

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create 2 new tables |
| `src/components/marketing/AutomatedMarketing.tsx` | New component |
| `src/pages/Marketing.tsx` | Add new tab |

