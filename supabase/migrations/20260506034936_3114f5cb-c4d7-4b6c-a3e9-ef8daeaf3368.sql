CREATE TABLE public.cloudinary_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_name text NOT NULL UNIQUE,
  cloud_name text NOT NULL,
  upload_preset text NOT NULL,
  api_key text,
  api_secret text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cloudinary_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on cloudinary_accounts"
  ON public.cloudinary_accounts FOR ALL
  USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX cloudinary_accounts_only_one_active
  ON public.cloudinary_accounts (is_active) WHERE is_active = true;

CREATE TRIGGER update_cloudinary_accounts_updated_at
  BEFORE UPDATE ON public.cloudinary_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.cloudinary_accounts (account_name, cloud_name, upload_preset, is_active)
VALUES ('Default', 'dd7qn3t3d', 'phpathlabs_cards', true);