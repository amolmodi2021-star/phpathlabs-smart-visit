-- Tally ledger names for company purchase vouchers (exact ledger spelling).
ALTER TABLE public.accounts_companies
  ADD COLUMN IF NOT EXISTS debit_to text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credit_to text NOT NULL DEFAULT '';