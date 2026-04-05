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
  placeholders JSONB DEFAULT '[]'::jsonb,
  table_config JSONB DEFAULT '{}'::jsonb,
  footer_lines JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.abnormal_card_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on abnormal_card_templates"
  ON public.abnormal_card_templates
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);