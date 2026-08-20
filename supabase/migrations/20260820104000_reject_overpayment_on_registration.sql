-- Also reject when payment *lines* exceed the bill (not only paid_amount),
-- so extra collection cannot be stored even if paid_amount was already capped.

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
