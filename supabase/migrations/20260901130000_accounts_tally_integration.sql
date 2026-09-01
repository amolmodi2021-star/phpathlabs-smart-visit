-- TallyPrime integration: ledger map, voucher outbox, card settlements

CREATE TABLE IF NOT EXISTS public.accounts_tally_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT '',
  income_ledger text NOT NULL DEFAULT 'Lab Collection',
  mdr_expense_ledger text NOT NULL DEFAULT 'Bank Charges',
  default_settlement_bank_ledger text NOT NULL DEFAULT '',
  tally_host text NOT NULL DEFAULT 'http://localhost:9000',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.accounts_tally_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.accounts_tally_mode_map (
  mode_key text PRIMARY KEY
    CHECK (mode_key IN ('cash', 'gpay', 'paytm', 'neft', 'credit_card')),
  label text NOT NULL,
  tally_ledger text NOT NULL DEFAULT '',
  uses_clearing boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.accounts_tally_mode_map (mode_key, label, tally_ledger, uses_clearing, sort_order)
VALUES
  ('cash', 'Cash', 'Cash', false, 10),
  ('gpay', 'GPay', 'GPay', false, 20),
  ('paytm', 'Paytm', 'Paytm', false, 30),
  ('neft', 'NEFT', 'NEFT', false, 40),
  ('credit_card', 'Credit Card', 'Credit Card Clearing', true, 50)
ON CONFLICT (mode_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.accounts_tally_voucher_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CHECK (kind IN ('collection_receipt', 'card_settlement')),
  day_key date,
  mode_key text
    CHECK (mode_key IS NULL OR mode_key IN ('cash', 'gpay', 'paytm', 'neft', 'credit_card')),
  settlement_id uuid,
  voucher_type text NOT NULL DEFAULT 'Receipt',
  voucher_date date NOT NULL,
  narration text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  claimed_at timestamptz,
  claimed_by text,
  next_retry_at timestamptz,
  last_error text,
  tally_response text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tally_outbox_collection_day_mode
  ON public.accounts_tally_voucher_outbox (day_key, mode_key)
  WHERE kind = 'collection_receipt'
    AND status IN ('pending', 'claimed', 'sent');

CREATE INDEX IF NOT EXISTS idx_tally_outbox_status_retry
  ON public.accounts_tally_voucher_outbox (status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS public.accounts_tally_card_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_key date,
  gross numeric(14,2) NOT NULL CHECK (gross > 0),
  bank_received numeric(14,2) NOT NULL CHECK (bank_received >= 0),
  mdr numeric(14,2) NOT NULL DEFAULT 0,
  bank_ledger text NOT NULL,
  settlement_date date NOT NULL DEFAULT (CURRENT_DATE),
  reference_no text,
  notes text,
  status text NOT NULL DEFAULT 'saved'
    CHECK (status IN ('saved', 'queued', 'posted', 'failed')),
  outbox_id uuid REFERENCES public.accounts_tally_voucher_outbox(id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_tally_card_settlements_mdr_check
    CHECK (abs((gross - bank_received) - mdr) < 0.02)
);

CREATE INDEX IF NOT EXISTS idx_tally_card_settlements_status
  ON public.accounts_tally_card_settlements (status, settlement_date DESC);

ALTER TABLE public.accounts_tally_voucher_outbox
  DROP CONSTRAINT IF EXISTS accounts_tally_voucher_outbox_settlement_id_fkey;
ALTER TABLE public.accounts_tally_voucher_outbox
  ADD CONSTRAINT accounts_tally_voucher_outbox_settlement_id_fkey
  FOREIGN KEY (settlement_id) REFERENCES public.accounts_tally_card_settlements(id) ON DELETE SET NULL;

ALTER TABLE public.accounts_tally_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_tally_mode_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_tally_voucher_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_tally_card_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_tally_settings_all" ON public.accounts_tally_settings;
CREATE POLICY "accounts_tally_settings_all"
  ON public.accounts_tally_settings FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "accounts_tally_mode_map_all" ON public.accounts_tally_mode_map;
CREATE POLICY "accounts_tally_mode_map_all"
  ON public.accounts_tally_mode_map FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "accounts_tally_voucher_outbox_all" ON public.accounts_tally_voucher_outbox;
CREATE POLICY "accounts_tally_voucher_outbox_all"
  ON public.accounts_tally_voucher_outbox FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "accounts_tally_card_settlements_all" ON public.accounts_tally_card_settlements;
CREATE POLICY "accounts_tally_card_settlements_all"
  ON public.accounts_tally_card_settlements FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_tally_settings TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_tally_mode_map TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_tally_voucher_outbox TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_tally_card_settlements TO anon, authenticated, service_role;
