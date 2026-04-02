

# WhatsApp API Settings — Generic Third-Party Provider

## Overview
Replace the AiSensy-specific references with a generic "WhatsApp API" configuration. Add a dedicated settings card where the user can configure their third-party WhatsApp API details (base URL, API key, auth header format, template name, body/header structure). The edge function will use these settings as-is, making it provider-agnostic.

## What Changes

### 1. Add WhatsApp API Settings Card (`src/components/LoyaltyCardSender.tsx`)
Add a new collapsible card section "WhatsApp API Settings" with these fields, all persisted in localStorage:
- **API Base URL** — the endpoint to POST messages to
- **API Key** — masked password input with show/hide toggle
- **Auth Header Name** — text input (e.g. `apikey`, `Authorization`, `x-api-key`) so it works with any provider
- **Auth Header Prefix** — optional prefix (e.g. `Basic`, `Bearer`, or empty)
- **Template Name** — the approved WhatsApp template name
- **Body Variables Mapping** — JSON input mapping param positions to card fields (e.g. `{"1":"Name","2":"Discount %"}`)
- **Media Header** — toggle to include card image URL in header

Add a "Send via WhatsApp" button that triggers the edge function after cards are generated.

### 2. Update Edge Function (`supabase/functions/send-loyalty-whatsapp/index.ts`)
Make the payload and auth header fully configurable:
- Accept `authHeaderName` and `authHeaderPrefix` from the request body
- Construct the auth header dynamically: `headers[authHeaderName] = prefix ? `${prefix} ${apiKey}` : apiKey`
- Keep the payload structure generic with configurable template name, body params array, and optional media header
- The frontend sends the exact structure the user's provider expects

### 3. Remove Hardcoded AiSensy References
- Remove any AiSensy-specific field names (`campaignName`, `fromNumber`, etc.) from the current code
- Keep the payload flexible: `templateName`, `params` array, optional `header.image.link`

## Files to Modify
- `src/components/LoyaltyCardSender.tsx` — Add settings card with all config fields, "Send via WhatsApp" button, localStorage persistence
- `supabase/functions/send-loyalty-whatsapp/index.ts` — Make auth header and payload provider-agnostic

## Technical Details
- localStorage keys: `loyalty_wa_baseUrl`, `loyalty_wa_apiKey`, `loyalty_wa_authHeaderName`, `loyalty_wa_authHeaderPrefix`, `loyalty_wa_templateName`
- API key input uses `type="password"` with eye toggle
- Edge function receives all config from frontend request body — no hardcoded provider assumptions

