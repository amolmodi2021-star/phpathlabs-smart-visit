-- All-time COMBO99 cohort. Lifetime revenue ignores the dashboard date range.

CREATE OR REPLACE FUNCTION public.dashboard_combo99_lifetime()
RETURNS TABLE (
  lifetime_revenue numeric,
  unique_patients bigint,
  lifetime_bills bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  combo_ids AS (
    SELECT c.id::text AS id
    FROM public.combos c
    WHERE regexp_replace(lower(COALESCE(c.combo_name, '')), '[^a-z0-9]', '', 'g') = 'combo99'
       OR regexp_replace(lower(COALESCE(c.display_name, '')), '[^a-z0-9]', '', 'g') = 'combo99'
  ),
  live AS (
    SELECT
      pr.id,
      NULLIF(upper(trim(COALESCE(pr.umr_number, ''))), '') AS umr_key,
      GREATEST(
        0,
        COALESCE(pr.final_amount, 0) - COALESCE(pr.home_visit_charges, 0)
      ) AS bill_amount,
      COALESCE(pr.tests, '[]'::jsonb) AS tests,
      COALESCE(pr.cancelled_tests, '[]'::jsonb) AS cancelled_tests
    FROM public.patient_registrations pr
    WHERE COALESCE(pr.bill_cancelled, false) = false
  ),
  combo_candidates AS (
    SELECT l.*
    FROM live l
    WHERE l.tests::text ILIKE '%combo99%'
       OR EXISTS (
         SELECT 1 FROM combo_ids c WHERE position(c.id in l.tests::text) > 0
       )
  ),
  candidate_cancelled AS (
    SELECT
      r.id AS registration_id,
      CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(trim(both '"' from elem::text), '')
        ELSE NULLIF(trim(COALESCE(elem->>'test_id', elem->>'id', '')), '')
      END AS cancel_id
    FROM combo_candidates r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cancelled_tests) = 'array' THEN r.cancelled_tests ELSE '[]'::jsonb END
    ) AS elem
  ),
  candidate_lines AS (
    SELECT
      r.id AS registration_id,
      NULLIF(trim(COALESCE(elem->>'test_id', '')), '') AS line_id,
      COALESCE(NULLIF(trim(COALESCE(elem->>'test_name', '')), ''), '') AS line_name
    FROM combo_candidates r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.tests) = 'array' THEN r.tests ELSE '[]'::jsonb END
    ) AS elem
    WHERE NULLIF(trim(COALESCE(elem->>'test_id', '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM candidate_cancelled c
        WHERE c.registration_id = r.id
          AND c.cancel_id = NULLIF(trim(COALESCE(elem->>'test_id', '')), '')
      )
  ),
  combo_regs AS (
    SELECT l.registration_id
    FROM candidate_lines l
    WHERE l.line_id IN (SELECT combo_ids.id FROM combo_ids)
       OR regexp_replace(lower(l.line_name), '[^a-z0-9]', '', 'g') = 'combo99'
    GROUP BY l.registration_id
  ),
  ever_umr AS (
    SELECT DISTINCT live.umr_key
    FROM combo_regs c
    JOIN live ON live.id = c.registration_id
    WHERE live.umr_key IS NOT NULL
  ),
  umr_totals AS (
    SELECT
      COALESCE(SUM(l.bill_amount), 0) AS revenue,
      COUNT(DISTINCT l.umr_key) AS patients,
      COUNT(*) AS bills
    FROM live l
    JOIN ever_umr e ON e.umr_key = l.umr_key
  ),
  no_umr AS (
    SELECT
      COALESCE(SUM(l.bill_amount), 0) AS revenue,
      COUNT(*) AS patients,
      COUNT(*) AS bills
    FROM combo_regs c
    JOIN live l ON l.id = c.registration_id
    WHERE l.umr_key IS NULL
  )
  SELECT
    ROUND(u.revenue + n.revenue, 2),
    (u.patients + n.patients)::bigint,
    (u.bills + n.bills)::bigint
  FROM umr_totals u
  CROSS JOIN no_umr n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_combo99_lifetime()
  TO anon, authenticated, service_role;
