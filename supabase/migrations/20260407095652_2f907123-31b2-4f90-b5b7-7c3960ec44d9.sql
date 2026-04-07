
DROP FUNCTION IF EXISTS public.get_patient_registrations_paginated(integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_patient_registrations_paginated(
  p_page integer DEFAULT 0, p_page_size integer DEFAULT 50, p_search text DEFAULT ''
)
RETURNS TABLE(
  id uuid, invoice_number text, mobile_number text, patient_name text,
  title text, gender text, dob date, doctor_name text, umr_number text,
  visit_type text, tests jsonb, gross_amount numeric, discount_amount numeric,
  net_amount numeric, final_amount numeric, paid_amount numeric, due_amount numeric,
  status text, created_at timestamptz, email text, address text,
  home_visit_charges numeric, payments jsonb, pickup_point_id uuid,
  global_discount_type text, global_discount_value numeric,
  refund_amount numeric, refund_mode text, refund_date timestamptz,
  cancelled_tests jsonb, bill_cancelled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.id, r.invoice_number, r.mobile_number, r.patient_name, r.title, r.gender,
    r.dob, r.doctor_name, r.umr_number, r.visit_type, r.tests,
    r.gross_amount, r.discount_amount, r.net_amount, r.final_amount,
    r.paid_amount, r.due_amount, r.status, r.created_at, r.email, r.address,
    r.home_visit_charges, r.payments, r.pickup_point_id,
    r.global_discount_type, r.global_discount_value,
    r.refund_amount, r.refund_mode, r.refund_date, r.cancelled_tests, r.bill_cancelled
  FROM patient_registrations r
  WHERE p_search = '' OR r.patient_name ILIKE '%' || p_search || '%'
    OR r.mobile_number ILIKE '%' || p_search || '%'
    OR r.invoice_number ILIKE '%' || p_search || '%'
    OR r.umr_number ILIKE '%' || p_search || '%'
  ORDER BY r.created_at DESC
  LIMIT p_page_size OFFSET p_page * p_page_size;
$$;

CREATE OR REPLACE FUNCTION public.get_all_patient_registrations(p_search text DEFAULT '')
RETURNS TABLE(
  id uuid, invoice_number text, mobile_number text, patient_name text,
  title text, gender text, dob date, doctor_name text, umr_number text,
  visit_type text, tests jsonb, gross_amount numeric, discount_amount numeric,
  net_amount numeric, final_amount numeric, paid_amount numeric, due_amount numeric,
  status text, created_at timestamptz, email text, address text,
  home_visit_charges numeric, payments jsonb,
  refund_amount numeric, refund_mode text, refund_date timestamptz,
  cancelled_tests jsonb, bill_cancelled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.id, r.invoice_number, r.mobile_number, r.patient_name, r.title, r.gender,
    r.dob, r.doctor_name, r.umr_number, r.visit_type, r.tests,
    r.gross_amount, r.discount_amount, r.net_amount, r.final_amount,
    r.paid_amount, r.due_amount, r.status, r.created_at, r.email, r.address,
    r.home_visit_charges, r.payments,
    r.refund_amount, r.refund_mode, r.refund_date, r.cancelled_tests, r.bill_cancelled
  FROM patient_registrations r
  WHERE p_search = '' OR r.patient_name ILIKE '%' || p_search || '%'
    OR r.mobile_number ILIKE '%' || p_search || '%'
    OR r.invoice_number ILIKE '%' || p_search || '%'
    OR r.umr_number ILIKE '%' || p_search || '%'
  ORDER BY r.created_at DESC;
$$;
