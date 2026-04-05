

# Abnormal Test Card Designer

## Overview
Build a visual card designer (similar to the Loyalty Card Designer) specifically for abnormal test report images. The designer will let you customize every visual element and generate mobile-friendly PNG cards with a dynamic-height table.

## Database
Create a new table `abnormal_card_templates` to store designer templates, mirroring `loyalty_card_templates` but with additional fields for table styling, footer content, and logo.

```sql
CREATE TABLE public.abnormal_card_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  logo_width INT DEFAULT 120,
  logo_height INT DEFAULT 60,
  logo_x REAL DEFAULT 2,
  logo_y REAL DEFAULT 2,
  background_color TEXT DEFAULT '#FFFFFF',
  header_bg_color TEXT DEFAULT '#2E3192',
  header_font_color TEXT DEFAULT '#FFFFFF',
  canvas_width INT DEFAULT 900,
  placeholders JSONB DEFAULT '[]',
  table_config JSONB DEFAULT '{}',
  footer_lines JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.abnormal_card_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.abnormal_card_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**`placeholders`** — array of draggable fields (Name, Mobile, UMR, Barcode) with x, y, fontSize, fontColor, bold properties.

**`table_config`** — JSON object storing: header font/size/color, row font/size/color, result color (red), border color, alternate row color, column widths.

**`footer_lines`** — array of text blocks (e.g. LabLine number, timings, address) each with text, fontSize, fontColor, bold, alignment.

## New Component: `AbnormalCardDesigner.tsx`

A full visual designer component with:

### Canvas Preview (left panel)
- Live preview of the card with sample data (3 sample test rows)
- Mobile-friendly fixed width (900px canvas, ~4:3+ aspect ratio, dynamic height)
- Sections rendered top-to-bottom:
  1. **Logo** — uploadable, resizable, draggable
  2. **Header fields** — Name, Mobile, UMR, Barcode (draggable, customizable font/size/color/bold)
  3. **Table** — 4 columns (Test Name, Date, Result in red, Normal Range) with sample rows
  4. **Footer** — multiple text lines (lab number, timings, address)

### Properties Panel (right sidebar)
- **Logo settings**: upload, width/height sliders, position
- **Field properties**: when a header field is selected — font size, color, bold, x/y position
- **Table settings**: header bg color, header font, row font, result highlight color, border color, alternate row color
- **Footer lines**: add/remove lines, each with text, font size, color, bold, alignment (left/center/right)
- **Global**: canvas width, background color, header band color

### Template Management
- Save/load/delete templates (stored in `abnormal_card_templates`)
- Upload logo to `loyalty-cards` storage bucket

## Integration with CRMAbnormalTests

- Replace the hardcoded `generateAbnormalCard()` function with a template-driven renderer
- Add a template selector dropdown before sending
- When generating cards, load the selected template's config and render accordingly
- Dynamic canvas height calculated from: header + fields + (rowHeight × test count) + footer lines

## CRM Page Update

- Add a new tab "Card Designer" in the CRM page between "Abnormal Tests" and "Blacklist"
- This tab renders the `AbnormalCardDesigner` component

## Technical Details

- Canvas rendering approach identical to `LoyaltyCardDesigner` — percentage-based positioning, drag-to-reposition
- Barcode uses the existing `drawBarcode()` from `cardRenderer.ts` (Code128C encoding)
- Logo loaded via blob URL (same CORS-safe approach as loyalty card backgrounds)
- Table height is dynamically calculated: `headerArea + tableHeaderHeight + (tests.length × rowHeight) + footerHeight`
- Image width fixed at template's `canvas_width` (default 900px, mobile-optimized)

