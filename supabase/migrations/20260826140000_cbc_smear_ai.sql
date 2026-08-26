-- CBC smear AI reviews + microscope image storage

INSERT INTO storage.buckets (id, name, public)
VALUES ('cbc-smears', 'cbc-smears', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public read on cbc-smears" ON storage.objects;
CREATE POLICY "Allow public read on cbc-smears"
ON storage.objects FOR SELECT
USING (bucket_id = 'cbc-smears');

DROP POLICY IF EXISTS "Allow public upload on cbc-smears" ON storage.objects;
CREATE POLICY "Allow public upload on cbc-smears"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'cbc-smears');

DROP POLICY IF EXISTS "Allow public update on cbc-smears" ON storage.objects;
CREATE POLICY "Allow public update on cbc-smears"
ON storage.objects FOR UPDATE
USING (bucket_id = 'cbc-smears');

DROP POLICY IF EXISTS "Allow public delete on cbc-smears" ON storage.objects;
CREATE POLICY "Allow public delete on cbc-smears"
ON storage.objects FOR DELETE
USING (bucket_id = 'cbc-smears');

CREATE TABLE IF NOT EXISTS public.cbc_smear_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.patient_registrations(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id),
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  analyzer_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_result jsonb,
  draft_result jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'interpreted', 'approved', 'discarded')),
  ai_model text,
  ai_confidence text,
  ai_notes text,
  interpreted_at timestamptz,
  interpreted_by text,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, test_id)
);

CREATE INDEX IF NOT EXISTS cbc_smear_reviews_status_idx
  ON public.cbc_smear_reviews (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS cbc_smear_reviews_reg_idx
  ON public.cbc_smear_reviews (registration_id);

ALTER TABLE public.cbc_smear_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cbc_smear_reviews_all" ON public.cbc_smear_reviews;
CREATE POLICY "cbc_smear_reviews_all"
ON public.cbc_smear_reviews
FOR ALL
USING (true)
WITH CHECK (true);

-- Registration IDs in Result Verification that have CBC / CBC+ESR entered rows
CREATE OR REPLACE FUNCTION public.lims_cbc_verification_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT pr.registration_id), '{}'::uuid[])
  FROM public.patient_results pr
  JOIN public.tests t ON t.id = pr.test_id
  WHERE pr.status IN ('entered', 'results_entered')
    AND (
      lower(COALESCE(t.test_name, '')) LIKE '%cbc%'
      OR lower(COALESCE(t.test_name, '')) LIKE '%complete blood count%'
      OR t.test_code IN ('TST0068', 'TST0069')
    );
$$;

REVOKE ALL ON FUNCTION public.lims_cbc_verification_candidate_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_cbc_verification_candidate_ids() TO authenticated, anon, service_role;

-- Auto-enable CBC tab for roles that already have Result Verification
UPDATE public.app_roles r
SET permissions = jsonb_set(
  COALESCE(r.permissions, '{}'::jsonb),
  '{tabs,/lims,sections}',
  (
    SELECT to_jsonb(
      ARRAY(
        SELECT DISTINCT s
        FROM unnest(
          COALESCE(
            (
              SELECT ARRAY(SELECT jsonb_array_elements_text(r.permissions->'tabs'->'/lims'->'sections'))
            ),
            ARRAY[]::text[]
          ) || ARRAY['cbc']
        ) AS s
      )
    )
  ),
  true
)
WHERE r.permissions->'tabs'->'/lims'->'sections' IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(r.permissions->'tabs'->'/lims'->'sections') s(v)
    WHERE v IN ('verification', 'result_verification', 'results')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(r.permissions->'tabs'->'/lims'->'sections') s(v)
    WHERE v = 'cbc'
  );
