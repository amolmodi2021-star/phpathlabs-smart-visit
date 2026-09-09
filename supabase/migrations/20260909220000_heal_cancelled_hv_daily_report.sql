-- Heal Daily Report cash tally after HV cancel accidentally zeroed live HVC /
-- registration_payment modes. Cash model is: keep Registration (+) frozen and
-- add Refund (−). Restore snapshots so gross/cash still net correctly.

-- 1) Restore home_visit_charges on cancelled bills from frozen registration_payment
--    (final = tests gross - discount + HVC).
UPDATE public.patient_registrations pr
SET home_visit_charges = sub.hvc
FROM (
  SELECT
    rp.registration_id,
    GREATEST(
      0,
      COALESCE(rp.final_amount, 0) + COALESCE(rp.discount_amount, 0) - COALESCE(rp.gross_amount, 0)
    ) AS hvc
  FROM public.payment_transactions rp
  WHERE rp.transaction_type = 'registration_payment'
) sub
WHERE pr.id = sub.registration_id
  AND COALESCE(pr.bill_cancelled, false) = true
  AND COALESCE(pr.home_visit_charges, 0) = 0
  AND sub.hvc > 0.009
  AND (
    COALESCE(pr.hv_charge_only, false) = true
    OR pr.visit_type = 'home_visit'
  );

-- 2) Restore registration_payment cash/paid when a cancel sync wiped modes to 0
--    but a refund row still holds the outflow amount.
UPDATE public.payment_transactions rp
SET
  paid_amount = restored.amt,
  total_amount = restored.amt,
  cash_amount = restored.cash,
  gpay_amount = restored.gpay,
  paytm_amount = restored.paytm,
  credit_card_amount = restored.credit_card,
  neft_amount = restored.neft,
  final_amount = CASE
    WHEN COALESCE(rp.final_amount, 0) <= 0.009 THEN restored.amt
    ELSE rp.final_amount
  END,
  remarks = TRIM(BOTH E'\n' FROM COALESCE(rp.remarks, '') || E'\nHealed 09/09/2026: restored registration cash from refund so Daily Report nets Registration(+) + Refund(-).')
FROM (
  SELECT DISTINCT ON (r.registration_id)
    r.registration_id,
    GREATEST(ABS(COALESCE(r.total_amount, 0)), COALESCE(r.refund_amount, 0)) AS amt,
    ABS(COALESCE(r.cash_amount, 0)) AS cash,
    ABS(COALESCE(r.gpay_amount, 0)) AS gpay,
    ABS(COALESCE(r.paytm_amount, 0)) AS paytm,
    ABS(COALESCE(r.credit_card_amount, 0)) AS credit_card,
    ABS(COALESCE(r.neft_amount, 0)) AS neft
  FROM public.payment_transactions r
  WHERE r.transaction_type IN ('refund', 'old_bill_refund')
    AND r.direction = 'out'
  ORDER BY r.registration_id, r.transaction_date DESC
) restored
WHERE rp.registration_id = restored.registration_id
  AND rp.transaction_type = 'registration_payment'
  AND COALESCE(rp.paid_amount, 0) <= 0.009
  AND COALESCE(rp.cash_amount, 0) = 0
  AND COALESCE(rp.gpay_amount, 0) = 0
  AND COALESCE(rp.paytm_amount, 0) = 0
  AND COALESCE(rp.credit_card_amount, 0) = 0
  AND COALESCE(rp.neft_amount, 0) = 0
  AND restored.amt > 0.009
  AND EXISTS (
    SELECT 1
    FROM public.patient_registrations pr
    WHERE pr.id = rp.registration_id
      AND COALESCE(pr.bill_cancelled, false) = true
  );