
CREATE TABLE public.report_layout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  top_margin_cm numeric NOT NULL DEFAULT 2.5,
  bottom_margin_cm numeric NOT NULL DEFAULT 1.5,
  letterhead_pdf_path text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.report_layout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on report_layout_settings" ON public.report_layout_settings FOR ALL USING (true) WITH CHECK (true);

-- Insert default row
INSERT INTO public.report_layout_settings (top_margin_cm, bottom_margin_cm) VALUES (2.5, 1.5);
