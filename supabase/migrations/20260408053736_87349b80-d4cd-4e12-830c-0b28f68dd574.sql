CREATE TABLE public.health_checkup_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  health_checkup_id UUID NOT NULL REFERENCES public.health_checkups(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.billing_profiles(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.health_checkup_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on health_checkup_profiles"
  ON public.health_checkup_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);