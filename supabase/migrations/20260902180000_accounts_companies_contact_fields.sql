-- Extend accounts companies with supplier contact details; vendors list is retired in UI.

ALTER TABLE public.accounts_companies
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_person text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_number text NOT NULL DEFAULT '';