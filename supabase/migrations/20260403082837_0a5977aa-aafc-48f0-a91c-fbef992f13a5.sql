ALTER TABLE public.marketing_templates
  ADD COLUMN api_base_url text,
  ADD COLUMN api_key text,
  ADD COLUMN auth_header_name text DEFAULT 'apikey',
  ADD COLUMN auth_header_prefix text DEFAULT '',
  ADD COLUMN from_number text;