

# Bidirectional Interface Demo Page — Plan

## Overview

Build a demo/testing page and supporting backend to simulate the bidirectional communication between your web app and lab middleware. The middleware will:
1. **Query** your endpoint with a barcode/sample ID to get the list of tests to process
2. **Post results** back after processing, which get stored automatically

The UI page will let you create test orders, monitor incoming requests, and view result logs in real-time.

## Database Tables

### `lims_test_orders`
Stores sample orders with their assigned tests.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| sample_id | text NOT NULL | Barcode / sample ID |
| patient_name | text | |
| tests | jsonb | Array of test objects `[{code, name, unit, status}]` |
| status | text | `pending` / `in_progress` / `completed` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `lims_interface_logs`
Logs every request and response for debugging.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| sample_id | text | |
| direction | text | `incoming` (middleware→app) or `outgoing` (app→middleware) |
| event_type | text | `query_tests` / `submit_results` |
| request_body | jsonb | Raw request payload |
| response_body | jsonb | Raw response payload |
| created_at | timestamptz | |

### `lims_test_results`
Stores individual test results received from middleware.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| order_id | uuid FK → lims_test_orders | |
| sample_id | text | |
| test_code | text | |
| test_name | text | |
| result_value | text | |
| unit | text | |
| reference_range | text | |
| flag | text | Normal/Abnormal |
| received_at | timestamptz | |

## Edge Function: `lims-interface`

A single edge function with two endpoints your middleware will call:

**GET `/lims-interface?action=query&sample_id=BARCODE123`**
- Looks up the sample_id in `lims_test_orders`
- Returns the list of tests to be processed
- Logs the interaction

**POST `/lims-interface` with body `{action: "results", sample_id, results: [...]}`**
- Receives result values from middleware
- Inserts into `lims_test_results`
- Updates the order status and individual test statuses
- Logs the interaction

Both endpoints are unauthenticated (verify_jwt = false) since middleware calls them directly.

## UI Page: `/lims-demo`

### Sections

1. **Create Test Order** — Form with sample_id, patient_name, and a multi-select of tests (code, name, unit). Saves to `lims_test_orders`.

2. **Active Orders** — Table showing all orders with status badges. Expandable rows showing individual test results as they come in. Real-time updates via Supabase Realtime.

3. **Interface Logs** — Chronological log of all middleware interactions (direction, event type, payloads, timestamps). Auto-refreshes.

4. **API Reference Panel** — Collapsible section showing the exact endpoint URLs and expected request/response formats for your middleware to use.

## Technical Details

- Enable Realtime on `lims_test_orders` and `lims_test_results` for live updates
- Permissive RLS policies (consistent with existing app pattern)
- Add route `/lims-demo` to App.tsx with the new page
- Add navigation link in AppLayout

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create 3 new tables, enable realtime |
| `supabase/functions/lims-interface/index.ts` | New edge function |
| `supabase/config.toml` | Add verify_jwt = false for lims-interface |
| `src/pages/LimsDemo.tsx` | New demo page |
| `src/App.tsx` | Add route |
| `src/components/AppLayout.tsx` | Add nav link |

