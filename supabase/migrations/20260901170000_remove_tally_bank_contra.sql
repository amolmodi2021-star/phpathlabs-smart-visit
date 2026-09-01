-- Remove auto bank contra feature
UPDATE public.accounts_tally_voucher_outbox
SET status = 'cancelled',
    last_error = 'contra_feature_removed',
    updated_at = now()
WHERE kind = 'bank_contra'
  AND status IN ('pending', 'claimed', 'failed', 'sent');

ALTER TABLE public.accounts_tally_voucher_outbox
  DROP CONSTRAINT IF EXISTS accounts_tally_voucher_outbox_kind_check;

ALTER TABLE public.accounts_tally_voucher_outbox
  ADD CONSTRAINT accounts_tally_voucher_outbox_kind_check
  CHECK (kind IN ('collection_receipt', 'card_settlement', 'bank_contra'));

-- Keep kind value in check so historical bank_contra rows remain valid,
-- but stop creating new ones from the app.

ALTER TABLE public.accounts_tally_settings
  DROP COLUMN IF EXISTS auto_bank_contra;
