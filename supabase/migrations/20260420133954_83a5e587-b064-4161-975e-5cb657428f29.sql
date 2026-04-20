-- Pickup Point Billing tables

CREATE TABLE public.pickup_point_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  pickup_point_id uuid NOT NULL,
  invoice_month int NOT NULL,
  invoice_year int NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  patient_count int NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  due_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  no_reminder boolean NOT NULL DEFAULT false,
  reminder_days int,
  last_reminder_sent_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pup_inv_pickup ON public.pickup_point_invoices(pickup_point_id);
CREATE INDEX idx_pup_inv_status ON public.pickup_point_invoices(status);
CREATE INDEX idx_pup_inv_period ON public.pickup_point_invoices(invoice_year, invoice_month);

ALTER TABLE public.pickup_point_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pickup_point_invoices" ON public.pickup_point_invoices FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.pickup_point_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.pickup_point_invoices(id) ON DELETE CASCADE,
  registration_id uuid,
  registration_invoice text,
  registration_date date,
  patient_name text,
  test_names text,
  net_amount numeric NOT NULL DEFAULT 0,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pup_inv_items_invoice ON public.pickup_point_invoice_items(invoice_id);
CREATE INDEX idx_pup_inv_items_reg ON public.pickup_point_invoice_items(registration_id);

ALTER TABLE public.pickup_point_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pickup_point_invoice_items" ON public.pickup_point_invoice_items FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.pickup_point_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.pickup_point_invoices(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  payment_mode text NOT NULL,
  reference_no text,
  remarks text,
  recorded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pup_inv_pay_invoice ON public.pickup_point_invoice_payments(invoice_id);

ALTER TABLE public.pickup_point_invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pickup_point_invoice_payments" ON public.pickup_point_invoice_payments FOR ALL USING (true) WITH CHECK (true);

-- Auto-assign invoice number PUP{MM}{YY}{NNN}
CREATE OR REPLACE FUNCTION public.auto_assign_pickup_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
  v_mm text;
  v_yy text;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;
  v_mm := LPAD(NEW.invoice_month::text, 2, '0');
  v_yy := LPAD((NEW.invoice_year % 100)::text, 2, '0');
  SELECT COALESCE(MAX(
    CASE WHEN invoice_number ~ ('^PUP' || v_mm || v_yy || '[0-9]+$')
         THEN substring(invoice_number from 8)::int
         ELSE 0 END
  ), 0) + 1
  INTO v_seq
  FROM public.pickup_point_invoices
  WHERE invoice_year = NEW.invoice_year AND invoice_month = NEW.invoice_month;
  NEW.invoice_number := 'PUP' || v_mm || v_yy || LPAD(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pickup_invoice_no
  BEFORE INSERT ON public.pickup_point_invoices
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_pickup_invoice_number();

-- Auto-update due_amount + status when paid_amount changes
CREATE OR REPLACE FUNCTION public.recalc_pickup_invoice_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.due_amount := GREATEST(NEW.total_amount - NEW.paid_amount, 0);
  IF NEW.paid_amount <= 0 THEN
    NEW.status := 'pending';
  ELSIF NEW.paid_amount >= NEW.total_amount THEN
    NEW.status := 'paid';
  ELSE
    NEW.status := 'partial';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pickup_invoice_status
  BEFORE INSERT OR UPDATE OF paid_amount, total_amount ON public.pickup_point_invoices
  FOR EACH ROW EXECUTE FUNCTION public.recalc_pickup_invoice_status();

-- Recalc invoice totals when payments change
CREATE OR REPLACE FUNCTION public.sync_pickup_invoice_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv uuid;
  v_paid numeric;
BEGIN
  v_inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.pickup_point_invoice_payments WHERE invoice_id = v_inv;
  UPDATE public.pickup_point_invoices SET paid_amount = v_paid WHERE id = v_inv;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_pickup_payment_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.pickup_point_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_pickup_invoice_paid();

-- Seed default app_settings keys (no-op if already exist)
INSERT INTO public.app_settings (setting_key, setting_value)
VALUES
  ('bank_account_name', ''),
  ('bank_account_number', ''),
  ('bank_name', ''),
  ('bank_branch', ''),
  ('bank_ifsc', ''),
  ('bank_micr', ''),
  ('bank_pan', ''),
  ('pickup_invoice_default_reminder_days', '15'),
  ('pickup_invoice_declaration', 'Income from this service is exempted from GST as per notification 12/2017 — Health Care Services.')
ON CONFLICT (setting_key) DO NOTHING;

-- Seed default reminder template
INSERT INTO public.message_templates (template_key, template_value)
VALUES (
  'pickup_invoice_reminder',
  'Dear {pickup_name},

This is a gentle reminder for invoice {invoice_no} (period {period}) with an outstanding balance of ₹{amount}. Kindly arrange payment at your earliest convenience.

Thank you,
PH PathLabs'
)
ON CONFLICT (template_key) DO NOTHING;