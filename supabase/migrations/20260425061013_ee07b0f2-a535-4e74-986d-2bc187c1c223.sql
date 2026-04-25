-- Backfill estimate_tests.item_type for packages, profiles and combos that lost their tag
UPDATE public.estimate_tests et
SET item_type = 'package'
FROM public.health_checkups h
WHERE h.id = et.test_id
  AND et.item_type IS DISTINCT FROM 'package';

UPDATE public.estimate_tests et
SET item_type = 'profile'
FROM public.billing_profiles p
WHERE p.id = et.test_id
  AND et.item_type IS DISTINCT FROM 'profile';

UPDATE public.estimate_tests et
SET item_type = 'combo'
FROM public.combos c
WHERE c.id = et.test_id
  AND et.item_type IS DISTINCT FROM 'combo';

-- Backfill patient_registrations.tests JSONB with the correct item_type for any
-- container row (package / profile / combo) whose tag was lost or stored as 'test'
UPDATE public.patient_registrations pr
SET tests = sub.new_tests
FROM (
  SELECT
    pr2.id,
    jsonb_agg(
      CASE
        WHEN h.id IS NOT NULL THEN jsonb_set(t, '{item_type}', '"package"'::jsonb, true)
        WHEN p.id IS NOT NULL THEN jsonb_set(t, '{item_type}', '"profile"'::jsonb, true)
        WHEN c.id IS NOT NULL THEN jsonb_set(t, '{item_type}', '"combo"'::jsonb, true)
        ELSE t
      END
      ORDER BY ord
    ) AS new_tests
  FROM public.patient_registrations pr2
  CROSS JOIN LATERAL jsonb_array_elements(pr2.tests) WITH ORDINALITY AS x(t, ord)
  LEFT JOIN public.health_checkups h ON h.id::text = (t->>'test_id')
  LEFT JOIN public.billing_profiles p ON p.id::text = (t->>'test_id')
  LEFT JOIN public.combos c ON c.id::text = (t->>'test_id')
  WHERE pr2.tests IS NOT NULL
    AND jsonb_typeof(pr2.tests) = 'array'
  GROUP BY pr2.id
) sub
WHERE pr.id = sub.id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(pr.tests) elem
    LEFT JOIN public.health_checkups h2 ON h2.id::text = (elem->>'test_id')
    LEFT JOIN public.billing_profiles p2 ON p2.id::text = (elem->>'test_id')
    LEFT JOIN public.combos c2 ON c2.id::text = (elem->>'test_id')
    WHERE
      (h2.id IS NOT NULL AND (elem->>'item_type') IS DISTINCT FROM 'package')
      OR (p2.id IS NOT NULL AND (elem->>'item_type') IS DISTINCT FROM 'profile')
      OR (c2.id IS NOT NULL AND (elem->>'item_type') IS DISTINCT FROM 'combo')
  );