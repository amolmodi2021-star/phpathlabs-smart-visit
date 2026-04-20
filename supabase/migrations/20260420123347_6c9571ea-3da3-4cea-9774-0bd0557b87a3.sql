-- Backfill patient_registrations.tests JSONB: set item_type='combo' where test_id matches a combo
UPDATE public.patient_registrations pr
SET tests = sub.new_tests
FROM (
  SELECT
    pr2.id,
    jsonb_agg(
      CASE
        WHEN c.id IS NOT NULL AND (t->>'item_type') IS DISTINCT FROM 'combo'
          THEN jsonb_set(t, '{item_type}', '"combo"'::jsonb, true)
        ELSE t
      END
      ORDER BY ord
    ) AS new_tests
  FROM public.patient_registrations pr2
  CROSS JOIN LATERAL jsonb_array_elements(pr2.tests) WITH ORDINALITY AS x(t, ord)
  LEFT JOIN public.combos c ON c.id::text = (t->>'test_id')
  WHERE pr2.tests IS NOT NULL
    AND jsonb_typeof(pr2.tests) = 'array'
  GROUP BY pr2.id
) sub
WHERE pr.id = sub.id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(pr.tests) elem
    JOIN public.combos c2 ON c2.id::text = (elem->>'test_id')
    WHERE (elem->>'item_type') IS DISTINCT FROM 'combo'
  );

-- Backfill estimate_tests.item_type='combo' for existing combo entries
UPDATE public.estimate_tests et
SET item_type = 'combo'
FROM public.combos c
WHERE c.id = et.test_id
  AND et.item_type IS DISTINCT FROM 'combo';