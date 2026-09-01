-- Allow bank contra vouchers + auto-contra setting
ALTER TABLE public.accounts_tally_voucher_outbox
  DROP CONSTRAINT IF EXISTS accounts_tally_voucher_outbox_kind_check;

ALTER TABLE public.accounts_tally_voucher_outbox
  ADD CONSTRAINT accounts_tally_voucher_outbox_kind_check
  CHECK (kind IN ('collection_receipt', 'card_settlement', 'bank_contra'));

ALTER TABLE public.accounts_tally_settings
  ADD COLUMN IF NOT EXISTS auto_bank_contra boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.accounts_tally_settings.auto_bank_contra IS
  'When true, Queue for Tally also queues Contra vouchers moving GPay/Paytm/NEFT into default_settlement_bank_ledger (HDFC).';
