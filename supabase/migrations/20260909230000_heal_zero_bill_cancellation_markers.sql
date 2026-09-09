-- Fix bill_cancellation rows that were logged with 0 gross/final after HVC was
-- refunded first (live totals already zero). Rebuild negatives from the frozen
-- registration_payment snapshot so Daily Report Gross/Final net to zero.

UPDATE public.payment_transactions bc
SET
  gross_amount = -snap.orig_gross,
  discount_amount = -snap.orig_discount,
  final_amount = -snap.orig_final,
  remarks = TRIM(BOTH E'\n' FROM COALESCE(bc.remarks, '') || E'\nHealed 09/09/2026: restored Bill Cancel offsets from registration snapshot (HVC refunded before cancel).')
FROM (
  SELECT
    rp.registration_id,
    COALESCE(rp.final_amount, 0) AS orig_final,
    COALESCE(rp.discount_amount, 0) AS orig_discount,
    COALESCE(rp.final_amount, 0) + COALESCE(rp.discount_amount, 0) AS orig_gross
  FROM public.payment_transactions rp
  WHERE rp.transaction_type = 'registration_payment'
) snap
WHERE bc.registration_id = snap.registration_id
  AND bc.transaction_type IN ('bill_cancellation', 'old_bill_cancellation')
  AND COALESCE(bc.final_amount, 0) = 0
  AND COALESCE(bc.gross_amount, 0) = 0
  AND snap.orig_final > 0.009;