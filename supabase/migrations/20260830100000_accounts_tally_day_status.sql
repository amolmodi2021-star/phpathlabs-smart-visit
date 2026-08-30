-- Accounts: Tally enter/reverify status per collection day (never includes "today" in UI).
CREATE TABLE IF NOT EXISTS public.accounts_tally_day_status (
  day_key date PRIMARY KEY,
  paid numeric NOT NULL DEFAULT 0,
  cash numeric NOT NULL DEFAULT 0,
  gpay numeric NOT NULL DEFAULT 0,
  paytm numeric NOT NULL DEFAULT 0,
  neft numeric NOT NULL DEFAULT 0,
  credit_card numeric NOT NULL DEFAULT 0,
  entered_at timestamptz NOT NULL DEFAULT now(),
  entered_by text,
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  last_verified_by text,
  verify_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_tally_day_status_verified
  ON public.accounts_tally_day_status (last_verified_at DESC);

ALTER TABLE public.accounts_tally_day_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_tally_day_status_all" ON public.accounts_tally_day_status;
CREATE POLICY "accounts_tally_day_status_all"
  ON public.accounts_tally_day_status
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_tally_day_status TO anon, authenticated, service_role;
