-- Prevent collecting more than the bill value, and repair 2608160020
-- where Edit Registration duplicated a GPay due-collection as a second line.

-- 1) Keep paid_amount / due_amount consistent with final_amount.
CREATE OR REPLACE FUNCTION public.enforce_bill_payment_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.final_amount IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.paid_amount := COALESCE(NEW.paid_amount, 0);
  IF NEW.paid_amount < 0 THEN
    NEW.paid_amount := 0;
  END IF;

  IF NEW.paid_amount > NEW.final_amount + 0.009 THEN
    RAISE EXCEPTION 'Payment (₹%) cannot exceed the bill value (₹%)',
      NEW.paid_amount, NEW.final_amount
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.due_amount := GREATEST(0, NEW.final_amount - NEW.paid_amount);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bill_payment_cap ON public.patient_registrations;
CREATE TRIGGER trg_enforce_bill_payment_cap
  BEFORE INSERT OR UPDATE OF paid_amount, due_amount, final_amount
  ON public.patient_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bill_payment_cap();

-- 2) Repair bill 2608160020: one GPay collection (due), not two.
-- Registration was unpaid; GPay 1730 was collected 4 minutes later; a later
-- "payment mode edited" wrote a second undated GPay line and copied it onto
-- the registration_payment audit row, so Daily Report showed GPay twice.
UPDATE public.patient_registrations
SET payments = COALESCE((
  SELECT jsonb_agg(p)
  FROM jsonb_array_elements(COALESCE(payments, '[]'::jsonb)) p
  WHERE p ? 'date'
), '[]'::jsonb)
WHERE invoice_number = '2608160020'
  AND COALESCE(final_amount, 0) > 0
  AND jsonb_array_length(COALESCE(payments, '[]'::jsonb)) > 1;

UPDATE public.payment_transactions
SET
  cash_amount = 0,
  gpay_amount = 0,
  paytm_amount = 0,
  credit_card_amount = 0,
  neft_amount = 0,
  total_amount = 0,
  paid_amount = 0,
  due_amount = COALESCE(final_amount, 1730),
  remarks = TRIM(BOTH E'\n' FROM COALESCE(remarks, '') || E'\nCorrected 16/08/2026: GPay was due collection only — removed duplicate registration GPay so Daily Report does not double-count.')
WHERE invoice_number = '2608160020'
  AND transaction_type = 'registration_payment';
