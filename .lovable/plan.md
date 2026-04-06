
# Consolidate WhatsApp Settings, Templates & History

## Problem
WhatsApp API settings and templates are scattered across Loyalty Cards, CRM, Marketing, and Abnormal Tests tabs. History is also duplicated. The abnormal card flow incorrectly asks for an expiry date.

## Changes

### 1. New Unified Page: `/whatsapp-settings`
- **WhatsApp API Settings** (single config): Base URL, API Key, Auth Header, From Number — stored once in `app_settings` with a unified prefix
- **Template Manager**: List all templates (ABC Card, Abnormal PNG, Promo, etc.) with their WhatsApp template name, body variable mapping, media header toggle, campaign name
- **Unified History**: All sent messages from every module (CRM, Loyalty, Marketing, Automated) shown in one searchable, filterable table

### 2. Simplify Existing Pages
- **Loyalty Cards**: Remove WhatsApp Settings tab → Replace with a template selector dropdown (pick from templates created in the unified page)
- **CRM Abnormal Tests**: Remove "Abnormal WA Settings" tab → Replace with template selector
- **Marketing**: Templates already exist in `marketing_templates` table — link them to the unified page; remove duplicate API config fields from each template
- **Automated Marketing**: Filters already reference `template_id` — no change needed

### 3. Remove Duplicate History Tabs
- Remove History tab from Loyalty Cards page
- Remove History tab from CRM page  
- Remove History tab from Marketing page
- Keep unified history on the new WhatsApp Settings page

### 4. Fix: Remove Expiry Date from Abnormal Card Flow
- In CRM Abnormal Tests, remove the expiry date prompt when selecting patients for abnormal card sending

### 5. Data Migration
- Migrate existing `loyalty_wa_*` and `abnormal_wa_*` settings from `app_settings` into a unified format
- Existing `marketing_templates` table already has per-template API config — consolidate to use shared API settings + template-specific fields only

## Files to Modify
| File | Action |
|------|--------|
| New: `src/pages/WhatsAppSettings.tsx` | Unified settings + templates + history page |
| `src/App.tsx` | Add route for `/whatsapp-settings` |
| `src/components/AppLayout.tsx` | Add nav link |
| `src/pages/LoyaltyCards.tsx` | Remove WA Settings & History tabs, add template selector |
| `src/pages/CRM.tsx` | Remove Abnormal WA Settings & History tabs, add template selector |
| `src/pages/Marketing.tsx` | Remove duplicate settings, add template selector |
| `src/components/crm/CRMAbnormalTests.tsx` | Remove expiry date field |
| `src/components/WhatsAppSettings.tsx` | Delete (replaced by new page) |
| `src/components/crm/CRMAbnormalWhatsAppSettings.tsx` | Delete (replaced by new page) |
