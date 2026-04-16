
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,
  invoice_number text NOT NULL,
  patient_name text,
  transaction_type text NOT NULL,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  performed_by text,
  cash_amount numeric DEFAULT 0,
  gpay_amount numeric DEFAULT 0,
  paytm_amount numeric DEFAULT 0,
  credit_card_amount numeric DEFAULT 0,
  neft_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  direction text NOT NULL DEFAULT 'in',
  gross_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  final_amount numeric DEFAULT 0,
  paid_amount numeric DEFAULT 0,
  due_amount numeric DEFAULT 0,
  refund_amount numeric DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on payment_transactions" ON public.payment_transactions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pt_date ON public.payment_transactions (transaction_date);
CREATE INDEX idx_pt_invoice ON public.payment_transactions (invoice_number);
CREATE INDEX idx_pt_reg ON public.payment_transactions (registration_id);
