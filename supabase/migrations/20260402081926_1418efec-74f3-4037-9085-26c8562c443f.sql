
-- Loyalty card templates
CREATE TABLE public.loyalty_card_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  background_image_url TEXT,
  placeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_card_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on loyalty_card_templates"
  ON public.loyalty_card_templates FOR ALL
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_loyalty_card_templates_updated_at
  BEFORE UPDATE ON public.loyalty_card_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Loyalty card jobs
CREATE TABLE public.loyalty_card_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES public.loyalty_card_templates(id) ON DELETE SET NULL,
  excel_data JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  total_cards INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  queue_enabled BOOLEAN NOT NULL DEFAULT true,
  delay_ms INTEGER NOT NULL DEFAULT 3000,
  whatsapp_template_name TEXT,
  whatsapp_variables_mapping JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_card_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on loyalty_card_jobs"
  ON public.loyalty_card_jobs FOR ALL
  USING (true) WITH CHECK (true);

-- Individual loyalty cards
CREATE TABLE public.loyalty_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.loyalty_card_jobs(id) ON DELETE CASCADE,
  patient_name TEXT,
  mobile TEXT,
  umr TEXT,
  discount TEXT,
  expiry_date TEXT,
  image_url TEXT,
  whatsapp_status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on loyalty_cards"
  ON public.loyalty_cards FOR ALL
  USING (true) WITH CHECK (true);

-- Storage bucket for loyalty card images
INSERT INTO storage.buckets (id, name, public) VALUES ('loyalty-cards', 'loyalty-cards', true);

CREATE POLICY "Allow public read on loyalty-cards"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'loyalty-cards');

CREATE POLICY "Allow public insert on loyalty-cards"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'loyalty-cards');

CREATE POLICY "Allow public update on loyalty-cards"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'loyalty-cards');

CREATE POLICY "Allow public delete on loyalty-cards"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'loyalty-cards');
