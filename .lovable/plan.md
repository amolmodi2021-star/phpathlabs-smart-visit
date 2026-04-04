

# CRM Module — Patient & Prospect Marketing Automation

## Overview

A new **CRM** module (password-protected, new sidebar item) that serves as the central hub for patient/prospect data management and automated WhatsApp marketing campaigns with filtering, sequencing, and daily quota control.

## Architecture — 5 Core Components

### 1. Database Tables

**`crm_contacts`** — Main patient/prospect table
| Column | Source | Description |
|--------|--------|-------------|
| `id` (uuid, PK) | auto | Internal ID |
| `primary_key` (text, UNIQUE) | Col U | UMR\|Mobile composite key (e.g. `UMR0024144\|9660146667`) |
| `location` | Col A | `PH VESU` = registered patient, `NON PHPL` = prospect |
| `umr_number` | Col B | UMR or source/blank for non-registered |
| `bill_number` | Col C | Used to determine latest visit |
| `visit_date` | Col D | Registration date+time (dd-mm-yyyy HH:mm) |
| `patient_name` | Col E | Updated per latest bill |
| `mobile_number` | Col F | 10-digit |
| `visit_type` | Col G | Home Visit / Self / Dr etc |
| `doctor_name` | Col J | |
| `gross_amount` | Col K | numeric |
| `discount_amount` | Col L | numeric |
| `net_amount` | Col M | numeric |
| `paid_amount` | Col N | numeric |
| `due_amount` | Col O | numeric |
| `payment_type` | Col P | Debit/Credit |
| `remarks` | Col Q | Receptionist remarks |
| `created_by` | Col R | Staff name |
| `record_tag` | Col S | `DAILY` / `NON PHPL` etc |
| `default_discount_pct` | Col T | Default 20 for new/updated |
| `last_sent_type` | Col V | What was last sent (loyalty card, abnormal, promo etc) |
| `last_sent_date` | Col W | timestamp |
| `days_since_last_sent` | computed | Generated column: `CURRENT_DATE - last_sent_date` |

**`crm_abnormal_tests`** — Per-test abnormal history linked to contacts
| Column | Description |
|--------|-------------|
| `id` (uuid, PK) | |
| `primary_key` (text, FK→crm_contacts) | Patient composite key |
| `test_name` | |
| `test_date` | dd-mm-yyyy |
| `result_value` | text |
| `normal_range` | text |
| `created_at` | |

**`crm_blacklist`** — Blacklisted mobile numbers
| Column | Description |
|--------|-------------|
| `id` (uuid, PK) | |
| `mobile_number` (text, UNIQUE) | 10-digit |
| `created_at` | |

**`crm_sequence_rules`** — Marketing automation sequence definitions
| Column | Description |
|--------|-------------|
| `id` (uuid, PK) | |
| `step_order` (int) | 1, 2, 3... |
| `action_type` | loyalty_card / abnormal_history / promotion / custom |
| `delay_days` (int) | Days after previous step |
| `filter_location` | PH VESU / NON PHPL / ALL |
| `template_id` (uuid, nullable) | Link to marketing_templates |
| `enabled` (bool) | |

**`crm_settings`** — stored in existing `app_settings` table
- `crm_daily_quota` — max messages per day
- Other CRM-specific settings

### 2. Excel Import Logic (Upload & Upsert)

- Parse Excel using existing `parseExcelFile` from `src/lib/excel.ts`
- Map columns A-U to table fields
- **Upsert logic using `primary_key` (Col U)**:
  - If `primary_key` exists → compare `bill_number`: if new is greater, update `visit_date`, `patient_name`, and all demographic columns
  - If `primary_key` is new → insert with `default_discount_pct = 20`, `record_tag = 'DAILY'`
- **NON PHPL → PH VESU upgrade**: When a new record has a matching mobile number to an existing `NON PHPL` record, delete the `NON PHPL` record and insert the new registered patient record
- Deduplicate on `primary_key` — reject duplicates within same upload
- Skip blacklisted numbers

### 3. UI Pages & Tabs (New `/crm` route)

Password-protected (9819111107). Tabs:

1. **Contacts** — Searchable, filterable table of all CRM contacts
   - Filters: Location (PH VESU / NON PHPL), visit date range, days since last sent, last sent type, record tag (DAILY), payment type
   - Bulk select for manual campaign sends
   - Export to Excel
   - Shows computed "Days Since Last Sent"

2. **Import Data** — Excel upload with column preview, import progress, summary of added/updated/deleted records

3. **Abnormal Tests** — Upload abnormal test Excel (primary_key, test_name, date, result, normal_range). View per-patient abnormal history. Option to combine tests per patient for a combined message

4. **Blacklist** — Add numbers manually or via Excel import. Remove duplicates button. Select/delete with password protection (9819111107). Select all + delete

5. **Sequences** — Define ordered marketing steps:
   - Step 1: Send Loyalty Card → filter: PH VESU only → delay: 0 days (immediate on import)
   - Step 2: Send Abnormal History → delay: X days after step 1
   - Step 3: Send Promotion → delay: Y days after step 2
   - Different actions for NON PHPL vs PH VESU contacts
   - Each step links to a marketing template

6. **Settings** — Daily message quota, sequence intervals, automation toggle

### 4. Automation Engine

- A scheduled edge function (cron) or manual trigger that:
  1. Reads sequence rules in order
  2. Filters eligible contacts (not blacklisted, matching location filter, enough days elapsed since last step)
  3. Respects daily quota limit
  4. Sends messages via existing `send-marketing-message` edge function proxy
  5. Updates `last_sent_type`, `last_sent_date` on each contact after successful send
  6. Logs campaign history to `marketing_campaigns`

### 5. Sidebar & Routing

- New nav item: **CRM** (with `Database` or `Contact` icon) — placed between Marketing and WhatsApp Webhook
- Route: `/crm`
- Password-gated like Loyalty Cards

## Implementation Order

Given the scope, this will be built in phases:

**Phase 1 — Data Foundation**
- Create `crm_contacts`, `crm_blacklist`, `crm_abnormal_tests`, `crm_sequence_rules` tables with RLS
- Build the Import Data tab with full upsert/upgrade logic
- Build the Contacts tab with filters and export

**Phase 2 — Blacklist & Abnormal Tests**
- Blacklist management (import, dedupe, delete)
- Abnormal test upload and per-patient view
- Combined message option

**Phase 3 — Sequences & Automation**
- Sequence rule builder UI
- Daily quota settings
- Automation edge function (scheduled cron)
- Campaign execution and logging

## Technical Notes

- All dates strictly `dd-mm-yyyy` format using existing `excel.ts` normalization
- Mobile numbers normalized to 10-digit, `+91` prefix for WhatsApp API payloads
- Existing `send-marketing-message` edge function reused for WhatsApp delivery
- `days_since_last_sent` computed as a generated column or calculated at query time
- Blacklist check applied before every send operation

