-- Allow cancelling / zeroing a bill that still has payment lines in JSON.
-- Client clears payments on cancel; this is a safety net so bill_cancelled
-- updates never trip enforce_bill_payment_cap mid-write.

CREATE OR REPLACE FUNCTION public.enforce_bill_payment_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payments_sum numeric := 0;
BEGIN
  IF NEW.final_amount IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.paid_amount := COALESCE(NEW.paid_amount, 0);
  IF NEW.paid_amount < 0 THEN
    NEW.paid_amount := 0;
  END IF;

  -- Cancelled bills are zeroed; skip line-sum check (payments may lag one write).
  IF COALESCE(NEW.bill_cancelled, false) THEN
    NEW.due_amount := GREATEST(0, NEW.final_amount - NEW.paid_amount);
    RETURN NEW;
  END IF;

  IF NEW.payments IS NOT NULL AND jsonb_typeof(NEW.payments) = 'array' THEN
    SELECT COALESCE(SUM(COALESCE((p->>'amount')::numeric, 0)), 0)
      INTO payments_sum
      FROM jsonb_array_elements(NEW.payments) p;
  END IF;

  IF NEW.paid_amount > NEW.final_amount + 0.009
     OR payments_sum > NEW.final_amount + 0.009 THEN
    RAISE EXCEPTION 'Collected amount is greater than total bill amount'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.due_amount := GREATEST(0, NEW.final_amount - NEW.paid_amount);
  RETURN NEW;
END;
$$;