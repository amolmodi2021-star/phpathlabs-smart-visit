
-- Fix: Drop restrictive policies and recreate as permissive

DROP POLICY IF EXISTS "Allow all on tests" ON public.tests;
CREATE POLICY "Allow all on tests" ON public.tests
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on estimates" ON public.estimates;
CREATE POLICY "Allow all on estimates" ON public.estimates
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on estimate_tests" ON public.estimate_tests;
CREATE POLICY "Allow all on estimate_tests" ON public.estimate_tests
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on home_visits" ON public.home_visits;
CREATE POLICY "Allow all on home_visits" ON public.home_visits
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on phlebotomists" ON public.phlebotomists;
CREATE POLICY "Allow all on phlebotomists" ON public.phlebotomists
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on message_templates" ON public.message_templates;
CREATE POLICY "Allow all on message_templates" ON public.message_templates
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
