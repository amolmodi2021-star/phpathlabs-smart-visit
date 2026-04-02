CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app_settings" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "Anyone can insert app_settings" ON public.app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update app_settings" ON public.app_settings FOR UPDATE USING (true);
