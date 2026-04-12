

# Optimize "New Numbers" Tab — Move Logic to Database RPC

## Problem
The New Numbers tab downloads **all 35,000+ CRM contacts**, **8,300+ message logs**, and **870 blacklist entries** to the client on every load. This is extremely slow and will only get worse.

## Solution
Create a single database RPC `get_new_numbers_paginated` that does the entire computation server-side (find log numbers NOT in CRM/blacklist, group, search, paginate) and returns only the 50 rows needed for the current page.

## Technical Details

### 1. New database migration — `get_new_numbers_paginated` RPC

```sql
CREATE OR REPLACE FUNCTION public.get_new_numbers_paginated(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  mobile text,
  patient_name text,
  last_message_type text,
  last_sent_at timestamptz,
  message_count bigint,
  total_count bigint
)
```

Logic inside the function:
- Extract distinct 10-digit mobiles from `message_send_log`
- LEFT JOIN exclude against `crm_contacts` and `crm_blacklist` (normalized to last 10 digits)
- Group by mobile, pick latest `sent_at`, `patient_name`, `message_type`, and count
- Apply ILIKE search filter on mobile/patient_name/message_type
- Return paginated results with a `total_count` column (using `COUNT(*) OVER()`)

### 2. Refactor `NewNumbers.tsx`

- Replace the heavy `useQuery` with a simple RPC call to `get_new_numbers_paginated`
- Add 300ms debounced search (same pattern as WhatsApp Chat)
- Keep the existing table UI and pagination controls
- Add skeleton loading state

### Files to modify
- **New migration**: Create `get_new_numbers_paginated` function + indexes
- **`src/components/marketing/NewNumbers.tsx`**: Replace client-side logic with single RPC call

