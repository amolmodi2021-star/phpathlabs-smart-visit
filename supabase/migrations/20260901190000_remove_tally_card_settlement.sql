-- Remove Card Settlement: daily receipts post exact card amounts; no clearing/settlement flow.

ALTER TABLE public.accounts_tally_voucher_outbox
  DROP CONSTRAINT IF EXISTS accounts_tally_voucher_outbox_settlement_id_fkey;

DELETE FROM public.accounts_tally_voucher_outbox
WHERE kind = 'card_settlement';

DROP TABLE IF EXISTS public.accounts_tally_card_settlements CASCADE;

ALTER TABLE public.accounts_tally_voucher_outbox
  DROP COLUMN IF EXISTS settlement_id;

ALTER TABLE public.accounts_tally_voucher_outbox
  DROP CONSTRAINT IF EXISTS accounts_tally_voucher_outbox_kind_check;

ALTER TABLE public.accounts_tally_voucher_outbox
  ADD CONSTRAINT accounts_tally_voucher_outbox_kind_check
  CHECK (kind IN ('collection_receipt'));