
-- Channels table (similar to pickup_points)
CREATE TABLE public.channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  contact_person TEXT,
  billing_type TEXT NOT NULL DEFAULT 'credit',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  default_discount_pct NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on channels" ON public.channels FOR ALL USING (true) WITH CHECK (true);

-- Channel prices table (similar to pickup_point_prices)
CREATE TABLE public.channel_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  custom_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(channel_id, test_id)
);

ALTER TABLE public.channel_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on channel_prices" ON public.channel_prices FOR ALL USING (true) WITH CHECK (true);

-- Add channel_id to patient_registrations
ALTER TABLE public.patient_registrations ADD COLUMN channel_id UUID REFERENCES public.channels(id);
