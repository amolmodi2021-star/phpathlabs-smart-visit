
-- 1. Pickup Points table
CREATE TABLE public.pickup_points (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text,
  address text,
  contact_person text,
  billing_type text NOT NULL DEFAULT 'credit',
  default_discount_pct numeric NOT NULL DEFAULT 0,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pickup_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pickup_points" ON public.pickup_points FOR ALL USING (true) WITH CHECK (true);

-- 2. Pickup Point Prices table
CREATE TABLE public.pickup_point_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pickup_point_id uuid NOT NULL REFERENCES public.pickup_points(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  custom_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pickup_point_id, test_id)
);

ALTER TABLE public.pickup_point_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pickup_point_prices" ON public.pickup_point_prices FOR ALL USING (true) WITH CHECK (true);

-- 3. Invoice Counter table
CREATE TABLE public.invoice_counter (
  date_key text NOT NULL PRIMARY KEY,
  last_sequence integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_counter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on invoice_counter" ON public.invoice_counter FOR ALL USING (true) WITH CHECK (true);

-- 4. Patient Registrations table
CREATE TABLE public.patient_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  mobile_number text NOT NULL,
  patient_name text NOT NULL,
  title text,
  gender text,
  dob date,
  email text,
  address text,
  doctor_name text DEFAULT 'SELF',
  umr_number text,
  visit_type text NOT NULL DEFAULT 'lab_visit',
  pickup_point_id uuid REFERENCES public.pickup_points(id),
  tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  gross_amount numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  home_visit_charges numeric NOT NULL DEFAULT 0,
  final_amount numeric NOT NULL DEFAULT 0,
  payments jsonb NOT NULL DEFAULT '[]'::jsonb,
  paid_amount numeric NOT NULL DEFAULT 0,
  due_amount numeric NOT NULL DEFAULT 0,
  global_discount_type text,
  global_discount_value numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'registered',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on patient_registrations" ON public.patient_registrations FOR ALL USING (true) WITH CHECK (true);

-- 5. Add test_code to tests table
ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS test_code text;

-- 6. Generate Invoice Number function
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  today text := to_char(CURRENT_DATE, 'YYMMDD');
  seq integer;
BEGIN
  INSERT INTO invoice_counter (date_key, last_sequence)
  VALUES (today, 1)
  ON CONFLICT (date_key) DO UPDATE SET last_sequence = invoice_counter.last_sequence + 1
  RETURNING last_sequence INTO seq;
  RETURN today || lpad(seq::text, 4, '0');
END;
$$;

-- 7. Paginated query for registered patients
CREATE OR REPLACE FUNCTION public.get_patient_registrations_paginated(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT ''
)
RETURNS TABLE(
  id uuid,
  invoice_number text,
  mobile_number text,
  patient_name text,
  title text,
  gender text,
  dob date,
  doctor_name text,
  umr_number text,
  visit_type text,
  tests jsonb,
  gross_amount numeric,
  discount_amount numeric,
  net_amount numeric,
  final_amount numeric,
  paid_amount numeric,
  due_amount numeric,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id, r.invoice_number, r.mobile_number, r.patient_name, r.title, r.gender,
    r.dob, r.doctor_name, r.umr_number, r.visit_type, r.tests,
    r.gross_amount, r.discount_amount, r.net_amount, r.final_amount,
    r.paid_amount, r.due_amount, r.status, r.created_at
  FROM patient_registrations r
  WHERE
    p_search = ''
    OR r.patient_name ILIKE '%' || p_search || '%'
    OR r.mobile_number ILIKE '%' || p_search || '%'
    OR r.invoice_number ILIKE '%' || p_search || '%'
    OR r.umr_number ILIKE '%' || p_search || '%'
  ORDER BY r.created_at DESC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$$;

-- 8. Count function for pagination
CREATE OR REPLACE FUNCTION public.get_patient_registrations_count(p_search text DEFAULT '')
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::bigint
  FROM patient_registrations r
  WHERE
    p_search = ''
    OR r.patient_name ILIKE '%' || p_search || '%'
    OR r.mobile_number ILIKE '%' || p_search || '%'
    OR r.invoice_number ILIKE '%' || p_search || '%'
    OR r.umr_number ILIKE '%' || p_search || '%';
$$;

-- 9. Triggers for updated_at
CREATE TRIGGER update_pickup_points_updated_at
  BEFORE UPDATE ON public.pickup_points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_patient_registrations_updated_at
  BEFORE UPDATE ON public.patient_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
