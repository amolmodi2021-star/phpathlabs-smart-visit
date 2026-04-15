

# Add LIMS Settings Tab with Invoice Designer

## What changes
1. **Replace** the "Pickup Points" and "Channels" tabs with a single **"Settings"** tab in the LIMS page.
2. Inside Settings, render a sub-tabs layout with three sections: **Pickup Points**, **Channels**, and **Invoice Designer**.
3. **Invoice Designer** — a simple form to configure invoice branding stored in `app_settings`:
   - Upload a logo image (stored in a new `invoice-assets` storage bucket)
   - Lab name (text input)
   - Address (textarea)
   - Contact number (text input)
   - Tagline (text input, e.g. "LabLine: 6356 55 66 99")
   - Live preview of the invoice header
4. **InvoicePreview** will read these settings and use them instead of the hardcoded "PH PathLabs" / "LabLine: 6356 55 66 99" header.

## Files

### New files
- `src/components/lims/LimsSettings.tsx` — Sub-tabs wrapper rendering Pickup Points, Channels, and Invoice Designer
- `src/components/lims/InvoiceDesigner.tsx` — Form to upload logo and edit lab name/address/contact; saves to `app_settings` with keys `invoice_lab_name`, `invoice_address`, `invoice_contact`, `invoice_tagline`, `invoice_logo_url`

### Modified files
- `src/pages/Lims.tsx` — Remove `pickup` and `channels` tabs, add `settings` tab pointing to `LimsSettings`
- `src/components/lims/InvoicePreview.tsx` — Fetch invoice settings from `app_settings` on mount; use them in the header (fall back to current hardcoded values if not set)

### Database migration
- Create `invoice-assets` public storage bucket for logo uploads
- RLS policy: anyone authenticated can upload/read

## Technical details

**Invoice Designer settings keys** (stored in `app_settings`):
| Key | Default |
|-----|---------|
| `invoice_lab_name` | PH PathLabs |
| `invoice_address` | (empty) |
| `invoice_contact` | LabLine: 6356 55 66 99 |
| `invoice_tagline` | Invoice / Sample Receipt |
| `invoice_logo_url` | (empty) |

**LimsSettings sub-tabs** use the same `Tabs` component pattern already used elsewhere. The `pickup` and `channels` RBAC keys remain valid — they'll be checked inside LimsSettings for sub-tab visibility.

**InvoicePreview** will add a small `useEffect` to load these 5 keys on mount and replace the hardcoded header text and optionally render the logo image.

