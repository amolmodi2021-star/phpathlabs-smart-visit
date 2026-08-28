-- Dashboard Tests Booked: expand packages/profiles/combos server-side and return lean rows.
-- Client only downloads summary (or one-test patient rows) - avoids pulling tests JSONB.

CREATE OR REPLACE FUNCTION public.dashboard_tests_booked_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  test_id text,
  test_name text,
  qty bigint,
  gross numeric,
  discount numeric,
  net numeric
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
  regs AS (
    SELECT
      pr.id,
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
    CROSS JOIN LATERAL jsonb_array_elements(r.cancelled_tests) AS elem
  ),
  billed_lines AS (
    SELECT
      r.id AS registration_id,
      ord AS line_ord,
      NULLIF(trim(COALESCE(elem->>'test_id', '')), '') AS line_id,
      lower(NULLIF(trim(COALESCE(elem->>'item_type', '')), '')) AS item_type_raw,
      COALESCE(NULLIF(trim(COALESCE(elem->>'test_name', '')), ''), 'Test') AS line_name,
      COALESCE((elem->>'price')::numeric, 0) AS line_price,
      CASE
        WHEN elem ? 'discounted_price'
          AND NULLIF(trim(COALESCE(elem->>'discounted_price', '')), '') IS NOT NULL
          THEN COALESCE((elem->>'discounted_price')::numeric, 0)
        ELSE GREATEST(
          0,
          COALESCE((elem->>'price')::numeric, 0) - COALESCE((elem->>'discount')::numeric, 0)
        )
      END AS line_net
    FROM regs r
    CROSS JOIN LATERAL jsonb_array_elements(r.tests) WITH ORDINALITY AS x(elem, ord)
    WHERE NULLIF(trim(COALESCE(elem->>'test_id', '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cancelled c
        WHERE c.registration_id = r.id
          AND c.cancel_id = NULLIF(trim(COALESCE(elem->>'test_id', '')), '')
      )
  ),
  typed AS (
    SELECT
      b.*,
      CASE
        WHEN b.item_type_raw IN ('package', 'profile', 'combo', 'test') THEN b.item_type_raw
        WHEN EXISTS (
          SELECT 1 FROM public.health_checkups h
          WHERE h.id::text = b.line_id
        ) THEN 'package'
        WHEN EXISTS (
          SELECT 1 FROM public.combos c
          WHERE c.id::text = b.line_id
        ) THEN 'combo'
        WHEN EXISTS (
          SELECT 1 FROM public.billing_profiles p
          WHERE p.id::text = b.line_id
        ) THEN 'profile'
        ELSE 'test'
      END AS item_type
    FROM billed_lines b
  ),
  profile_leaves AS (
    SELECT
      bpt.profile_id::text AS container_id,
      bpt.test_id::text AS leaf_id
    FROM public.billing_profile_tests bpt
  ),
  package_leaves AS (
    SELECT
      hct.health_checkup_id::text AS container_id,
      hct.test_id::text AS leaf_id
    FROM public.health_checkup_tests hct
    UNION
    SELECT
      hcp.health_checkup_id::text AS container_id,
      pl.leaf_id
    FROM public.health_checkup_profiles hcp
    JOIN profile_leaves pl ON pl.container_id = hcp.profile_id::text
  ),
  combo_leaves AS (
    SELECT
      ct.combo_id::text AS container_id,
      ct.test_id::text AS leaf_id
    FROM public.combo_tests ct
    UNION
    SELECT
      cp.combo_id::text AS container_id,
      pl.leaf_id
    FROM public.combo_profiles cp
    JOIN profile_leaves pl ON pl.container_id = cp.profile_id::text
  ),
  container_leaf_raw AS (
    SELECT t.registration_id, t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, pl.leaf_id
    FROM typed t
    JOIN package_leaves pl ON pl.container_id = t.line_id
    WHERE t.item_type = 'package'
    UNION ALL
    SELECT t.registration_id, t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, pl.leaf_id
    FROM typed t
    JOIN profile_leaves pl ON pl.container_id = t.line_id
    WHERE t.item_type = 'profile'
    UNION ALL
    SELECT t.registration_id, t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, cl.leaf_id
    FROM typed t
    JOIN combo_leaves cl ON cl.container_id = t.line_id
    WHERE t.item_type = 'combo'
  ),
  container_leaf_uniq AS (
    SELECT DISTINCT ON (registration_id, line_ord, leaf_id)
      registration_id, line_ord, line_id, line_name, line_net, item_type, leaf_id
    FROM container_leaf_raw
    WHERE NOT EXISTS (
      SELECT 1
      FROM cancelled c
      WHERE c.registration_id = container_leaf_raw.registration_id
        AND c.cancel_id = container_leaf_raw.leaf_id
    )
    ORDER BY registration_id, line_ord, leaf_id
  ),
  catalog AS (
    SELECT
      t.id::text AS id,
      COALESCE(NULLIF(trim(t.display_name), ''), NULLIF(trim(t.test_name), ''), 'Test') AS name,
      COALESCE(t.price, 0)::numeric AS price
    FROM public.tests t
  ),
  weighted AS (
    SELECT
      clu.*,
      COALESCE(cat.price, 0)::numeric AS leaf_price,
      COALESCE(cat.name, clu.line_name) AS leaf_name,
      SUM(COALESCE(cat.price, 0)) OVER (
        PARTITION BY clu.registration_id, clu.line_ord
      ) AS sum_w,
      COUNT(*) OVER (
        PARTITION BY clu.registration_id, clu.line_ord
      ) AS leaf_cnt,
      ROW_NUMBER() OVER (
        PARTITION BY clu.registration_id, clu.line_ord
        ORDER BY clu.leaf_id
      ) AS leaf_rn
    FROM container_leaf_uniq clu
    LEFT JOIN catalog cat ON cat.id = clu.leaf_id
  ),
  container_contrib AS (
    SELECT
      w.leaf_id AS test_id,
      w.leaf_name AS test_name,
      ROUND(w.leaf_price, 2) AS gross,
      CASE
        WHEN w.leaf_rn = w.leaf_cnt THEN
          ROUND(
            w.line_net
            - COALESCE(
              SUM(ROUND(
                CASE
                  WHEN w.sum_w > 0 THEN w.line_net * (w.leaf_price / w.sum_w)
                  ELSE w.line_net / w.leaf_cnt
                END,
                2
              )) OVER (
                PARTITION BY w.registration_id, w.line_ord
                ORDER BY w.leaf_rn
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            ),
            2
          )
        ELSE
          ROUND(
            CASE
              WHEN w.sum_w > 0 THEN w.line_net * (w.leaf_price / w.sum_w)
              ELSE w.line_net / w.leaf_cnt
            END,
            2
          )
      END AS net
    FROM weighted w
  ),
  container_final AS (
    SELECT
      test_id,
      test_name,
      gross,
      GREATEST(0, ROUND(gross - net, 2)) AS discount,
      net
    FROM container_contrib
  ),
  direct_final AS (
    SELECT
      t.line_id AS test_id,
      COALESCE(cat.name, t.line_name) AS test_name,
      ROUND(t.line_price, 2) AS gross,
      GREATEST(0, ROUND(t.line_price - t.line_net, 2)) AS discount,
      ROUND(t.line_net, 2) AS net
    FROM typed t
    LEFT JOIN catalog cat ON cat.id = t.line_id
    WHERE t.item_type = 'test'
  ),
  all_contrib AS (
    SELECT * FROM container_final
    UNION ALL
    SELECT * FROM direct_final
  )
  SELECT
    a.test_id,
    MAX(a.test_name) AS test_name,
    COUNT(*)::bigint AS qty,
    ROUND(SUM(a.gross), 2) AS gross,
    ROUND(SUM(a.discount), 2) AS discount,
    ROUND(SUM(a.net), 2) AS net
  FROM all_contrib a
  GROUP BY a.test_id
  ORDER BY COUNT(*) DESC, MAX(a.test_name) ASC;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dashboard_tests_booked_patients(
  p_from timestamptz,
  p_to timestamptz,
  p_test_id text
)
RETURNS TABLE (
  test_id text,
  test_name text,
  gross numeric,
  discount numeric,
  net numeric,
  registration_id text,
  invoice_number text,
  patient_name text,
  title text,
  created_at text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR NULLIF(trim(COALESCE(p_test_id, '')), '') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  regs AS (
    SELECT
      pr.id,
      COALESCE(pr.invoice_number, '-') AS invoice_number,
      COALESCE(pr.patient_name, '-') AS patient_name,
      pr.title,
      pr.created_at,
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
    CROSS JOIN LATERAL jsonb_array_elements(r.cancelled_tests) AS elem
  ),
  billed_lines AS (
    SELECT
      r.id AS registration_id,
      r.invoice_number,
      r.patient_name,
      r.title,
      r.created_at,
      ord AS line_ord,
      NULLIF(trim(COALESCE(elem->>'test_id', '')), '') AS line_id,
      lower(NULLIF(trim(COALESCE(elem->>'item_type', '')), '')) AS item_type_raw,
      COALESCE(NULLIF(trim(COALESCE(elem->>'test_name', '')), ''), 'Test') AS line_name,
      COALESCE((elem->>'price')::numeric, 0) AS line_price,
      CASE
        WHEN elem ? 'discounted_price'
          AND NULLIF(trim(COALESCE(elem->>'discounted_price', '')), '') IS NOT NULL
          THEN COALESCE((elem->>'discounted_price')::numeric, 0)
        ELSE GREATEST(
          0,
          COALESCE((elem->>'price')::numeric, 0) - COALESCE((elem->>'discount')::numeric, 0)
        )
      END AS line_net
    FROM regs r
    CROSS JOIN LATERAL jsonb_array_elements(r.tests) WITH ORDINALITY AS x(elem, ord)
    WHERE NULLIF(trim(COALESCE(elem->>'test_id', '')), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cancelled c
        WHERE c.registration_id = r.id
          AND c.cancel_id = NULLIF(trim(COALESCE(elem->>'test_id', '')), '')
      )
  ),
  typed AS (
    SELECT
      b.*,
      CASE
        WHEN b.item_type_raw IN ('package', 'profile', 'combo', 'test') THEN b.item_type_raw
        WHEN EXISTS (
          SELECT 1 FROM public.health_checkups h WHERE h.id::text = b.line_id
        ) THEN 'package'
        WHEN EXISTS (
          SELECT 1 FROM public.combos c WHERE c.id::text = b.line_id
        ) THEN 'combo'
        WHEN EXISTS (
          SELECT 1 FROM public.billing_profiles p WHERE p.id::text = b.line_id
        ) THEN 'profile'
        ELSE 'test'
      END AS item_type
    FROM billed_lines b
  ),
  profile_leaves AS (
    SELECT bpt.profile_id::text AS container_id, bpt.test_id::text AS leaf_id
    FROM public.billing_profile_tests bpt
  ),
  package_leaves AS (
    SELECT hct.health_checkup_id::text AS container_id, hct.test_id::text AS leaf_id
    FROM public.health_checkup_tests hct
    UNION
    SELECT hcp.health_checkup_id::text, pl.leaf_id
    FROM public.health_checkup_profiles hcp
    JOIN profile_leaves pl ON pl.container_id = hcp.profile_id::text
  ),
  combo_leaves AS (
    SELECT ct.combo_id::text AS container_id, ct.test_id::text AS leaf_id
    FROM public.combo_tests ct
    UNION
    SELECT cp.combo_id::text, pl.leaf_id
    FROM public.combo_profiles cp
    JOIN profile_leaves pl ON pl.container_id = cp.profile_id::text
  ),
  container_leaf_raw AS (
    SELECT t.registration_id, t.invoice_number, t.patient_name, t.title, t.created_at,
           t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, pl.leaf_id
    FROM typed t
    JOIN package_leaves pl ON pl.container_id = t.line_id
    WHERE t.item_type = 'package'
    UNION ALL
    SELECT t.registration_id, t.invoice_number, t.patient_name, t.title, t.created_at,
           t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, pl.leaf_id
    FROM typed t
    JOIN profile_leaves pl ON pl.container_id = t.line_id
    WHERE t.item_type = 'profile'
    UNION ALL
    SELECT t.registration_id, t.invoice_number, t.patient_name, t.title, t.created_at,
           t.line_ord, t.line_id, t.line_name, t.line_net, t.item_type, cl.leaf_id
    FROM typed t
    JOIN combo_leaves cl ON cl.container_id = t.line_id
    WHERE t.item_type = 'combo'
  ),
  container_leaf_uniq AS (
    SELECT DISTINCT ON (registration_id, line_ord, leaf_id)
      registration_id, invoice_number, patient_name, title, created_at,
      line_ord, line_id, line_name, line_net, item_type, leaf_id
    FROM container_leaf_raw
    WHERE NOT EXISTS (
      SELECT 1
      FROM cancelled c
      WHERE c.registration_id = container_leaf_raw.registration_id
        AND c.cancel_id = container_leaf_raw.leaf_id
    )
    ORDER BY registration_id, line_ord, leaf_id
  ),
  catalog AS (
    SELECT
      t.id::text AS id,
      COALESCE(NULLIF(trim(t.display_name), ''), NULLIF(trim(t.test_name), ''), 'Test') AS name,
      COALESCE(t.price, 0)::numeric AS price
    FROM public.tests t
  ),
  weighted AS (
    SELECT
      clu.*,
      COALESCE(cat.price, 0)::numeric AS leaf_price,
      COALESCE(cat.name, clu.line_name) AS leaf_name,
      SUM(COALESCE(cat.price, 0)) OVER (
        PARTITION BY clu.registration_id, clu.line_ord
      ) AS sum_w,
      COUNT(*) OVER (
        PARTITION BY clu.registration_id, clu.line_ord
      ) AS leaf_cnt,
      ROW_NUMBER() OVER (
        PARTITION BY clu.registration_id, clu.line_ord
        ORDER BY clu.leaf_id
      ) AS leaf_rn
    FROM container_leaf_uniq clu
    LEFT JOIN catalog cat ON cat.id = clu.leaf_id
  ),
  container_contrib AS (
    SELECT
      w.leaf_id AS test_id,
      w.leaf_name AS test_name,
      ROUND(w.leaf_price, 2) AS gross,
      CASE
        WHEN w.leaf_rn = w.leaf_cnt THEN
          ROUND(
            w.line_net
            - COALESCE(
              SUM(ROUND(
                CASE
                  WHEN w.sum_w > 0 THEN w.line_net * (w.leaf_price / w.sum_w)
                  ELSE w.line_net / w.leaf_cnt
                END,
                2
              )) OVER (
                PARTITION BY w.registration_id, w.line_ord
                ORDER BY w.leaf_rn
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            ),
            2
          )
        ELSE
          ROUND(
            CASE
              WHEN w.sum_w > 0 THEN w.line_net * (w.leaf_price / w.sum_w)
              ELSE w.line_net / w.leaf_cnt
            END,
            2
          )
      END AS net,
      w.registration_id::text AS registration_id,
      w.invoice_number,
      w.patient_name,
      w.title,
      w.created_at
    FROM weighted w
  ),
  container_final AS (
    SELECT
      test_id,
      test_name,
      gross,
      GREATEST(0, ROUND(gross - net, 2)) AS discount,
      net,
      registration_id,
      invoice_number,
      patient_name,
      title,
      created_at
    FROM container_contrib
  ),
  direct_final AS (
    SELECT
      t.line_id AS test_id,
      COALESCE(cat.name, t.line_name) AS test_name,
      ROUND(t.line_price, 2) AS gross,
      GREATEST(0, ROUND(t.line_price - t.line_net, 2)) AS discount,
      ROUND(t.line_net, 2) AS net,
      t.registration_id::text AS registration_id,
      t.invoice_number,
      t.patient_name,
      t.title,
      t.created_at
    FROM typed t
    LEFT JOIN catalog cat ON cat.id = t.line_id
    WHERE t.item_type = 'test'
  ),
  all_contrib AS (
    SELECT * FROM container_final
    UNION ALL
    SELECT * FROM direct_final
  )
  SELECT
    a.test_id,
    a.test_name,
    a.gross,
    a.discount,
    a.net,
    a.registration_id,
    a.invoice_number,
    a.patient_name,
    a.title,
    a.created_at::text
  FROM all_contrib a
  WHERE a.test_id = trim(p_test_id)
  ORDER BY a.created_at DESC NULLS LAST;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_tests_booked_summary(timestamptz, timestamptz)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_tests_booked_patients(timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;
