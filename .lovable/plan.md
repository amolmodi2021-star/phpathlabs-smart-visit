

# Plan: WhatsApp-Style Chat Page

## Overview
Build a full WhatsApp-like messaging interface that unifies outbound messages (from `message_send_log`) and inbound messages (from `webhook_messages`) into a single conversation view, grouped by mobile number. Desktop shows a two-panel layout (contact list + chat); mobile shows a single-panel flow.

## Database Changes

### 1. Add columns to `webhook_messages`
- `message_type` text (text/image/location/button/interactive/status)
- `media_url` text (for images)
- `message_id` text (for correlating status updates)
- `location_lat` numeric, `location_lng` numeric
- `delivery_status` text (sent/delivered/read/failed)
- `error_info` jsonb (for failed status details)

### 2. Enable realtime on `webhook_messages`
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_messages;
```

## Edge Function: Update `whatsapp-webhook`
Currently only handles text messages and skips status events. Update to:
- **Image**: extract `messages.image.url`, store in `media_url`, set `message_type = 'image'`
- **Location**: extract lat/lng from `messages.location.text`, store in `location_lat`/`location_lng`
- **Button reply**: extract `messages.button.text`
- **Interactive/list reply**: extract `messages.interactive.text.list_reply.title`
- **Status events** (currently skipped): instead of skipping, find the original message by `messageId` and update its `delivery_status` (delivered/read/failed) and `error_info`
- Store `messageId` on every inbound/outbound insert for correlation
- Also log outbound auto-replies with their `messageId`

## New Page: `src/pages/WhatsAppChat.tsx`

### Contact List Panel (left / main on mobile)
- Query: aggregate both tables by 10-digit mobile number
  - `webhook_messages`: group by `sender_number` (strip to 10 digits)
  - `message_send_log`: group by `mobile_number`
  - Union and pick latest message timestamp per number
- Sort descending by last message time
- Show for each contact:
  - Profile name (from webhook `sender_name`) or resolved name from CRM > Home Visits > Estimates
  - 10-digit mobile number
  - Last message preview (truncated)
  - Timestamp (relative: "Today 10:30 AM", "Yesterday", date)
  - Unread indicator for new inbound messages
- Search bar to filter contacts by name or number

### Conversation Panel (right / pushed view on mobile)
- Header: contact name, number, back arrow (mobile)
- Message bubbles:
  - **Outbound** (from `message_send_log`): right-aligned, green bubble. Show message type badge since no content is stored (e.g., "Estimate Sent", "Marketing Message", "Home Visit")
  - **Outbound auto-reply** (from `webhook_messages` direction=outbound): right-aligned, show actual message
  - **Inbound text**: left-aligned, white bubble with message text
  - **Inbound image**: show thumbnail with link
  - **Inbound location**: show Google Maps link with lat/lng
  - **Inbound button/list reply**: show the reply text in a styled chip
  - **Status ticks**: single tick (sent), double tick (delivered), blue double tick (read), red X (failed with error tooltip)
- Timestamp grouping by day ("Today", "Yesterday", "12 April 2026")
- Sorted ascending (oldest on top, newest at bottom, auto-scroll)

### Name Resolution Logic
For each 10-digit mobile number, resolve display name with priority:
1. `crm_contacts.patient_name` (latest by `updated_at`) 
2. `home_visits` via `estimates` (join estimates on mobile, latest)
3. `estimates.patient_name` (latest by `created_at`)
4. `webhook_messages.sender_name` (WhatsApp profile name)
5. Fallback: show mobile number only

### UI Design
- **Desktop**: WhatsApp Web layout -- left sidebar (30% width) with contact list, right panel (70%) with chat. Green header bar (#075E54), chat background pattern (#ECE5DD)
- **Mobile**: Full-screen contact list; tapping opens full-screen chat with back button. Native WhatsApp look with same colors
- Use the existing `useIsMobile` hook for responsive switching

### Notifications
- Subscribe to `webhook_messages` via Supabase Realtime (INSERT events where direction = 'inbound')
- On new inbound message:
  - Play notification sound (`/notification.mp3` already exists)
  - Show browser Notification with sender name + message preview
  - Clicking notification navigates to the chat with that contact open
- Request Notification permission on page load

## Sidebar Addition
- Add nav item `{ to: "/whatsapp-chat", label: "WhatsApp Chat", icon: MessageCircle }` to `allNavItems` in `AppLayout.tsx`
- Add route in `App.tsx`
- Add to role permissions structure (add `/whatsapp-chat` key)

## Files to Create/Modify
- **Create**: `src/pages/WhatsAppChat.tsx` (main page with both panels)
- **Modify**: `supabase/functions/whatsapp-webhook/index.ts` (handle all message types + status updates)
- **Modify**: `src/components/AppLayout.tsx` (add nav item)
- **Modify**: `src/App.tsx` (add route)
- **Migration**: add columns to `webhook_messages`, enable realtime

## Technical Notes
- Conversations are built by merging queries from both tables client-side, normalized to 10-digit numbers
- Status updates use `messageId` correlation -- webhook receives status event, finds matching row, updates `delivery_status`
- The page will use `useQuery` with realtime cache invalidation (existing `useRealtimeSync` pattern)

