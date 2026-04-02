

# Fix WhatsApp API Payload Structure

## Problem
The current payload has `body` and `header` as **top-level** fields, but the AOC Portal API requires them **nested inside `components`**. Also, since your template has **no body variables** (only a dynamic image header), `body.params` should be an empty array `[]`.

Current (wrong):
```json
{
  "from": "...", "to": "...", "templateName": "...",
  "components": "",
  "type": "template",
  "body": { "params": [...] },
  "header": { "type": "image", "image": { "link": "..." } }
}
```

Required (per API docs):
```json
{
  "from": "...", "to": "...", "templateName": "...",
  "type": "template",
  "campaignName": "...",
  "components": {
    "body": { "params": [] },
    "header": { "type": "image", "image": { "link": "mediaUrl" } }
  }
}
```

## Changes

### 1. Fix Edge Function (`supabase/functions/send-loyalty-whatsapp/index.ts`)
- Move `body` and `header` inside a `components` object instead of being top-level fields
- When no variable mapping exists (like your case), send `params: []` (empty array)
- Always include `campaignName` in payload (even if empty string)
- Remove the old top-level `components: ""` string

### 2. No frontend changes needed
The `LoyaltyCardSender.tsx` settings UI remains the same — only the edge function payload structure needs fixing.

## Technical Detail
The payload will be restructured to:
```typescript
const components: Record<string, unknown> = {
  body: { params: params.length > 0 ? params : [] },
};
if (includeMediaHeader && card.image_url) {
  components.header = {
    type: "image",
    image: { link: card.image_url },
  };
}

const payload = {
  from: fromNumber,
  to: toNumber,
  templateName,
  campaignName: campaignName || "",
  type: "template",
  components,
};
```

