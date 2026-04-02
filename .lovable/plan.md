

# ABC Loyalty Card Module — Implementation Plan

## Overview

A new "Loyalty Cards" module that lets you:
1. Design a loyalty card with a background image and draggable/configurable text placeholders
2. Upload an Excel sheet with patient data to bulk-generate personalized card JPG images
3. Send cards via WhatsApp API (Interakt/Wati/AiSensy) with queue and delay controls

## Architecture

```text
┌─────────────────────────────────────────────────┐
│  Loyalty Cards Page (new route /loyalty-cards)   │
├──────────┬──────────────┬───────────────────────┤
│ Card     │ Excel Upload │ WhatsApp Send         │
│ Designer │ & Preview    │ Queue Manager         │
└──────────┴──────────────┴───────────────────────┘
       │            │                │
       ▼            ▼                ▼
  Lovable Cloud   Edge Function:    Edge Function:
  Storage         generate-card     send-loyalty-whatsapp
  (backgrounds    (HTML→image)      (WhatsApp BSP API)
   + generated
   cards)
```

## Step-by-Step Plan

### 1. Database Setup
Create a `loyalty_card_templates` table:
- `id`, `name`, `background_image_url`, `placeholders` (JSONB — array of {field, x, y, fontSize, fontColor, bold}), `created_at`, `updated_at`

Create a `loyalty_card_jobs` table:
- `id`, `template_id`, `excel_data` (JSONB), `status` (pending/processing/completed/failed), `total_cards`, `sent_count`, `queue_enabled`, `delay_ms`, `whatsapp_template_name`, `whatsapp_variables_mapping` (JSONB), `created_at`

Create a `loyalty_cards` table:
- `id`, `job_id`, `patient_name`, `mobile`, `umr`, `discount`, `expiry_date`, `image_url`, `whatsapp_status` (pending/sent/failed), `sent_at`

### 2. Card Designer UI (frontend)
- Upload background image → stored in Lovable Cloud Storage (`loyalty-cards` bucket)
- Define placeholders: Name, Mobile, UMR, Discount %, Expiry Date
- For each placeholder: position (x, y via drag or manual input), font size, color (color picker), bold toggle
- Live preview using HTML Canvas rendering of the card with sample data
- Save template to `loyalty_card_templates`

### 3. Image Generation (Edge Function: `generate-loyalty-card`)
- Receives: background image URL, placeholder config, patient data
- Uses **Deno Canvas (jsr:@gfx/canvas)** to render the background image and overlay text at configured positions with styling
- Outputs a JPG buffer → uploaded to Lovable Cloud Storage
- Returns public URL
- This approach produces exact JPG images matching the uploaded background

### 4. Bulk Generation Flow (frontend + edge function)
- Upload Excel with columns: Name, Mobile, UMR, Discount %, Expiry Date
- Parse with xlsx library (already in project), preview data in a table
- On "Generate Cards": call edge function for each row, store results in `loyalty_cards` table
- Show progress bar with generated/total count

### 5. WhatsApp Integration (Edge Function: `send-loyalty-whatsapp`)
- Settings panel: WhatsApp API key (stored as secret), API base URL, template name, variable mapping
- Edge function calls the BSP API (Interakt/Wati/AiSensy) with:
  - Media URL (public card image URL from storage)
  - Template variables mapped from patient data
- Queue controls:
  - **Queue enabled**: send one-by-one with configurable delay (e.g., 2-5 seconds between messages)
  - **Queue disabled**: fire all requests together
- Status tracking per card (pending → sent / failed) with live UI updates

### 6. Navigation & Route
- Add `/loyalty-cards` route and nav item with `CreditCard` icon
- New page: `src/pages/LoyaltyCards.tsx` with tabs: "Card Designer" | "Send Cards" | "History"

## Technical Details

**Image generation approach**: Deno Canvas (`jsr:@gfx/canvas`) in the edge function can load the background JPG, draw text with exact font/size/color/bold settings, and export as JPG. This produces real image files matching the uploaded background exactly.

**Storage bucket**: New `loyalty-cards` bucket (public) for backgrounds and generated cards.

**WhatsApp API secret**: Will use `add_secret` tool to request the API key once you confirm your BSP provider and are ready to integrate.

**Files to create/modify**:
- `src/pages/LoyaltyCards.tsx` — main page with 3 tabs
- `src/components/LoyaltyCardDesigner.tsx` — card template designer
- `src/components/LoyaltyCardSender.tsx` — Excel upload + send flow
- `supabase/functions/generate-loyalty-card/index.ts` — image generation
- `supabase/functions/send-loyalty-whatsapp/index.ts` — WhatsApp sending
- `src/App.tsx` — add route
- `src/components/AppLayout.tsx` — add nav item
- DB migration for 3 new tables + storage bucket

