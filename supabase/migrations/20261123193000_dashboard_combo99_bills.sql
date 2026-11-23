-- Dashboard COMBO99: patients who booked COMBO99, with the full test bill on that invoice.

CREATE OR REPLACE FUNCTION public.dashboard_combo99_bills(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  registration_id text,
  invoice_number text,
  patient_name text,
  title text,
  created_at text,
  booked_on text,
  combo_qty bigint,
  other_test_count bigint,
  bill_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  combo_ids AS (
    SELECT c.id::text AS id
    FROM public.combos c
    WHERE regexp_replace(lower(COALESCE(c.combo_name, '')), '[^a-z0-9]', '', 'g') = 'combo99'
       OR regexp_replace(lower(COALESCE(c.display_name, '')), '[^a-z0-9]', '', 'g') = 'combo99'
  ),
  regs AS (
    SELECT
      pr.id,
      pr.invoice_number,
      pr.patient_name,
      pr.title,
      pr.created_at,
      GREATEST(
        0,
        COALESCE(pr.final_amount, 0) - COALESCE(pr.home_visit_charges, 0)
      ) AS bill_amount,
      COALESCE(pr.tests, '[]'::jsonb) AS tests,
      COALESCE(pr.cancelled_tests, '[]'::jsonb) AS cancelled_tests
    FROM public.patient_registrations pr
    WHERE pr.created_at >= p_from
      AND pr.created_at <= p_to
      AND COALESCE(pr.bill_cancelled, false) = false
  ),
  cancelled AS (
    SELECT
      r.id AS registration_id,
      CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(trim(both '"' from elem::text), '')
        ELSE NULLIF(trim(COALESCE(elem->>'test_id', elem->>'id', '')), '')
      END AS cancel_id
    FROM regs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cancelled_tests) = 'array' THEN r.cancelled_tests ELSE '[]'::jsonb END
    ) AS elem
  ),
  lines AS (
    SELECT
      r.id AS registration_id,
      NULLIF(trim(COALESCE(elem->>'test_id', '')), '') AS line_id,
      COALESCE(NULLIF(trim(COALESCE(elem->>'test_name', '')), ''), '') AS line_name
    FROM regs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.tests) = 'array' THEN r.tests ELSE '[]'::jsonb END
    ) AS elem
    WHERE NULLIF(trim(COALESCE(elem->>'test_id', '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cancelled c
        WHERE c.registration_id = r.id
          AND c.cancel_id = NULLIF(trim(COALESCE(elem->>'test_id', '')), '')
      )
  ),
  marked AS (
    SELECT
      l.registration_id,
      (
        l.line_id IN (SELECT combo_ids.id FROM combo_ids)
        OR regexp_replace(lower(l.line_name), '[^a-z0-9]', '', 'g') = 'combo99'
      ) AS is_combo99
    FROM lines l
  ),
  per_reg AS (
    SELECT
      m.registration_id,
      COUNT(*) FILTER (WHERE m.is_combo99) AS combo_qty,
      COUNT(*) FILTER (WHERE NOT m.is_combo99) AS other_test_count
    FROM marked m
    GROUP BY m.registration_id
  )
  SELECT
    r.id::text,
    COALESCE(NULLIF(trim(r.invoice_number), ''), '—'),
    COALESCE(NULLIF(trim(r.patient_name), ''), '—'),
    r.title,
    r.created_at::text,
    to_char((r.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    p.combo_qty,
    p.other_test_count,
    ROUND(r.bill_amount, 2)
  FROM per_reg p
  JOIN regs r ON r.id = p.registration_id
  WHERE p.combo_qty > 0
  ORDER BY r.created_at;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_combo99_bills(timestamptz, timestamptz)
  TO anon, authenticated, service_role;
