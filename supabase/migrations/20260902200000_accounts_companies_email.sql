ALTER TABLE public.accounts_companies
  ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';