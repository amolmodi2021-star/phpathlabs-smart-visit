

# WhatsApp Chat Performance Optimization Plan

## Problem
Currently, the WhatsApp Chat loads up to 5,000 webhook messages, 5,000 send logs, 5,000 CRM contacts, and 2,000 estimates all at once. As data grows, this will become slow and unresponsive.

## Solution Overview
Implement server-side pagination for both the contact list and the message thread, and move heavy computations (name resolution, unread counts, contact building) to a database function.

---

## Step 1: Create a database function for paginated contacts

Build an RPC `get_wa_contacts_paginated` that:
- Unions `webhook_messages` and `message_send_log` to find distinct mobile numbers
- Joins against `crm_contacts` and `estimates` for name resolution (server-side)
- Computes unread count per contact from `webhook_messages.is_read = false`
- Returns: mobile, name, profile_name, last_message, last_time, unread_count
- Accepts: `p_search`, `p_offset`, `p_limit`, `p_unread_only`
- Ordered by last_time DESC

This eliminates loading thousands of rows client-side just to build the sidebar.

## Step 2: Create a database function for paginated messages

Build an RPC `get_wa_chat_messages` that:
- Takes `p_mobile_10` (the contact's normalized number), `p_limit`, `p_offset`
- Unions `webhook_messages` and `message_send_log` for that contact, deduplicating by message_id
- Returns messages ordered by timestamp DESC (newest first), paginated
- Client reverses the order for display

This replaces the current approach of loading 10,000 rows and filtering client-side.

## Step 3: Refactor the WhatsApp Chat component

**Contact list sidebar:**
- Replace the two 5,000-row queries + client-side contact building with a single RPC call
- Add "load more" infinite scroll or a simple pagination button at the bottom
- Page size: 30 contacts at a time
- Search triggers the RPC with `p_search`

**Message thread:**
- Load latest 50 messages initially via the new RPC
- Add a "Load older messages" button at the top of the chat
- Keep the auto-scroll-to-bottom behavior for new messages

**Remove bulk queries:**
- Remove the `wa-chat-crm` and `wa-chat-estimates` queries entirely (name resolution is now server-side)
- Remove the `wa-chat-webhook` and `wa-chat-sendlog` bulk queries
- Replace with targeted paginated RPC calls

**Realtime updates:**
- Keep realtime subscriptions, but on new message arrival, just prepend to the current message list or invalidate the current page query
- On new inbound from a new contact, invalidate the contacts query

## Step 4: Add database indexes

Create indexes to support the new queries:
- `webhook_messages(sender_number, created_at DESC)`
- `message_send_log(mobile_number, sent_at DESC)`
- `webhook_messages(is_read)` where direction = 'inbound'

---

## Files to modify
- **New migration**: Database function `get_wa_contacts_paginated`, `get_wa_chat_messages`, and indexes
- **`src/pages/WhatsAppChat.tsx`**: Major refactor to use paginated RPCs instead of bulk loading

## What stays the same
- Compose bar, file upload, send logic
- Realtime subscriptions (adjusted to work with paginated data)
- Mark as read/unread functionality
- Message rendering (ticks, media, etc.)

