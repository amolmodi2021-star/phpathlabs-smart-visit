-- COMBO99 dashboard: split COMBO99 line value from other tests on the same bill.
-- Total revenue is COMBO99 bills only. Lifetime revenue keeps every bill for that UMR.

DROP FUNCTION IF EXISTS public.dashboard_combo99_bills(timestamptz, timestamptz);

CREATE FUNCTION public.dashboard_combo99_bills(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  registration_id text,
  invoice_number text,
  patient_name text,
  title text,
  umr_number text,
  created_at text,
  booked_on text,
  combo_qty bigint,
  other_test_count bigint,
  bill_amount numeric,
  lifetime_bill numeric,
  lifetime_visits bigint,
  combo_amount numeric
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
  live AS (
    SELECT
      pr.id,
      NULLIF(upper(trim(COALESCE(pr.umr_number, ''))), '') AS umr_key,
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
    WHERE COALESCE(pr.bill_cancelled, false) = false
  ),
  combo_candidates AS (
    SELECT l.*
    FROM live l
    WHERE l.tests::text ILIKE '%combo99%'
       OR EXISTS (
         SELECT 1
         FROM combo_ids c
         WHERE position(c.id in l.tests::text) > 0
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
  candidate_marked AS (
    SELECT
      l.registration_id,
      (
        l.line_id IN (SELECT combo_ids.id FROM combo_ids)
        OR regexp_replace(lower(l.line_name), '[^a-z0-9]', '', 'g') = 'combo99'
      ) AS is_combo99
    FROM candidate_lines l
  ),
  combo_regs AS (
    SELECT
      m.registration_id,
      COUNT(*) FILTER (WHERE m.is_combo99) AS combo_qty
    FROM candidate_marked m
    GROUP BY m.registration_id
    HAVING COUNT(*) FILTER (WHERE m.is_combo99) > 0
  ),
  ever_umr AS (
    SELECT DISTINCT l.umr_key
    FROM combo_regs c
    JOIN live l ON l.id = c.registration_id
    WHERE l.umr_key IS NOT NULL
  ),
  lifetime AS (
    SELECT
      l.umr_key,
      ROUND(SUM(l.bill_amount), 2) AS lifetime_bill,
      COUNT(*)::bigint AS lifetime_visits
    FROM live l
    JOIN ever_umr e ON e.umr_key = l.umr_key
    GROUP BY l.umr_key
  ),
  range_regs AS (
    SELECT l.*
    FROM live l
    WHERE l.created_at >= p_from
      AND l.created_at <= p_to
      AND (
        l.umr_key IN (SELECT ever_umr.umr_key FROM ever_umr)
        OR l.id IN (SELECT combo_regs.registration_id FROM combo_regs)
      )
  ),
  range_cancelled AS (
    SELECT
      r.id AS registration_id,
      CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(trim(both '"' from elem::text), '')
        ELSE NULLIF(trim(COALESCE(elem->>'test_id', elem->>'id', '')), '')
      END AS cancel_id
    FROM range_regs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.cancelled_tests) = 'array' THEN r.cancelled_tests ELSE '[]'::jsonb END
    ) AS elem
  ),
  range_lines AS (
    SELECT
      r.id AS registration_id,
      NULLIF(trim(COALESCE(elem->>'test_id', '')), '') AS line_id,
      COALESCE(NULLIF(trim(COALESCE(elem->>'test_name', '')), ''), '') AS line_name,
      CASE
        WHEN elem ? 'discounted_price'
          AND NULLIF(trim(COALESCE(elem->>'discounted_price', '')), '') IS NOT NULL
          THEN COALESCE((elem->>'discounted_price')::numeric, 0)
        ELSE GREATEST(
          0,
          COALESCE((elem->>'price')::numeric, 0) - COALESCE((elem->>'discount')::numeric, 0)
        )
      END AS line_net
    FROM range_regs r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.tests) = 'array' THEN r.tests ELSE '[]'::jsonb END
    ) AS elem
    WHERE NULLIF(trim(COALESCE(elem->>'test_id', '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM range_cancelled c
        WHERE c.registration_id = r.id
          AND c.cancel_id = NULLIF(trim(COALESCE(elem->>'test_id', '')), '')
      )
  ),
  range_marked AS (
    SELECT
      l.registration_id,
      l.line_net,
      (
        l.line_id IN (SELECT combo_ids.id FROM combo_ids)
        OR regexp_replace(lower(l.line_name), '[^a-z0-9]', '', 'g') = 'combo99'
      ) AS is_combo99
    FROM range_lines l
  ),
  range_counts AS (
    SELECT
      m.registration_id,
      COUNT(*) FILTER (WHERE m.is_combo99) AS combo_qty,
      COUNT(*) FILTER (WHERE NOT m.is_combo99) AS other_test_count,
      COALESCE(SUM(m.line_net) FILTER (WHERE m.is_combo99), 0) AS combo_amount
    FROM range_marked m
    GROUP BY m.registration_id
  )
  SELECT
    r.id::text,
    COALESCE(NULLIF(trim(r.invoice_number), ''), '—'),
    COALESCE(NULLIF(trim(r.patient_name), ''), '—'),
    r.title,
    COALESCE(r.umr_key, ''),
    r.created_at::text,
    to_char((r.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    COALESCE(rc.combo_qty, 0),
    COALESCE(rc.other_test_count, 0),
    ROUND(r.bill_amount, 2),
    CASE
      WHEN r.umr_key IS NULL THEN ROUND(r.bill_amount, 2)
      ELSE COALESCE(lt.lifetime_bill, ROUND(r.bill_amount, 2))
    END,
    CASE
      WHEN r.umr_key IS NULL THEN 1::bigint
      ELSE COALESCE(lt.lifetime_visits, 1)
    END,
    LEAST(
      GREATEST(COALESCE(rc.combo_amount, 0), 0),
      GREATEST(ROUND(r.bill_amount, 2), 0)
    )
  FROM range_regs r
  LEFT JOIN range_counts rc ON rc.registration_id = r.id
  LEFT JOIN lifetime lt ON lt.umr_key = r.umr_key
  WHERE COALESCE(rc.combo_qty, 0) > 0 OR r.umr_key IS NOT NULL
  ORDER BY r.created_at;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_combo99_bills(timestamptz, timestamptz)
  TO anon, authenticated, service_role;
