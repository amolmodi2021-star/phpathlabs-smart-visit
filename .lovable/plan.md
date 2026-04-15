

# Add Alignment & Visibility Controls to Invoice Designer

## What changes
Add alignment options (left/center/right) for logo, lab name, tagline, and address. Add a toggle to show/hide the lab name. All saved to `app_settings` and respected in `InvoicePreview`.

## New setting keys in `app_settings`

| Key | Default | Values |
|-----|---------|--------|
| `invoice_logo_align` | `center` | `left`, `center`, `right` |
| `invoice_lab_name_align` | `center` | `left`, `center`, `right` |
| `invoice_lab_name_visible` | `true` | `true`, `false` |
| `invoice_tagline_align` | `center` | `left`, `center`, `right` |
| `invoice_address_align` | `center` | `left`, `center`, `right` |

## Changes

### `src/components/lims/InvoiceDesigner.tsx`
1. Add 5 new keys to `SETTING_KEYS` and `DEFAULTS`.
2. For each element (Logo, Lab Name, Tagline, Address), add a 3-button toggle group (Left / Center / Right) using `RadioGroup` or simple button group with active styling.
3. For Lab Name, add a `Switch` toggle for visibility.
4. Update the live preview to respect alignment (`textAlign`) and visibility settings.

### `src/components/lims/InvoicePreview.tsx`
1. Add the 5 new keys to `SETTING_KEYS` and `DEFAULTS`.
2. Apply `textAlign` from alignment settings to logo, lab name, tagline, and address elements.
3. Conditionally hide lab name when `invoice_lab_name_visible === "false"`.
4. For the logo, set appropriate `margin` based on alignment (e.g., `margin: "0 auto"` for center, `0` for left, `0 0 0 auto` for right).

### No database migration needed
Uses existing `app_settings` table with new keys.

