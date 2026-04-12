

# Plan: Add Reply Section to WhatsApp Chat

## What
Add a WhatsApp-style compose bar at the bottom of the chat panel, supporting text replies, image sharing, and document sharing. Messages are sent via the AOC API through the existing `whatsapp-proxy` edge function.

## How It Works
1. **Text replies**: User types message, hits send → calls whatsapp-proxy with `type: "text"` payload
2. **Image replies**: User clicks attachment icon → picks image file → uploads to Supabase storage → sends image URL via `type: "image"` payload
3. **Document replies**: Same flow but with `type: "document"` payload

API credentials (`apiKey`, `fromNumber`, `baseUrl`, `authHeaderName`) are loaded from `app_settings` (global `wa_global_*` keys).

Sent replies are logged to `message_send_log` and also inserted into `webhook_messages` (as outbound) so they appear immediately in the chat.

## Files to Modify

### 1. `src/pages/WhatsAppChat.tsx`
- Add a compose bar below the messages area with: text input, send button, attachment menu (image/document)
- Load global WA settings from `app_settings` on mount
- On send: call `supabase.functions.invoke("whatsapp-proxy", ...)` with the appropriate payload format
- After successful send: insert into `webhook_messages` (direction: outbound) and `message_send_log` for tracking
- Extract `messageId` from proxy response for delivery status tracking
- Add a storage bucket upload flow for image/document attachments

### 2. Database migration
- Create a `chat-attachments` storage bucket for uploaded images/documents (public, with RLS)

## Payload Formats (from AOC API docs)

**Text:**
```json
{ "recipient_type": "individual", "from": "+91...", "to": "+91{mobile}", "type": "text", "text": { "body": "message" } }
```

**Image:**
```json
{ "recipient_type": "individual", "from": "+91...", "to": "+91{mobile}", "type": "image", "image": { "link": "https://...", "caption": "optional" } }
```

**Document:**
```json
{ "recipient_type": "individual", "from": "+91...", "to": "+91{mobile}", "type": "document", "document": { "link": "https://...", "caption": "optional" } }
```

## UI Design
- Compose bar pinned at bottom of chat panel, matching WhatsApp's green/white styling
- Attachment icon (paperclip) opens a small menu: "Image" and "Document"
- File picker opens native file dialog; after upload, shows preview before sending
- Send button (green arrow icon) on the right
- Loading spinner while message is being sent

