
-- Fix RLS policies: change from RESTRICTIVE to PERMISSIVE
DROP POLICY IF EXISTS "Allow all on tests" ON public.tests;
CREATE POLICY "Allow all on tests" ON public.tests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on estimates" ON public.estimates;
CREATE POLICY "Allow all on estimates" ON public.estimates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on estimate_tests" ON public.estimate_tests;
CREATE POLICY "Allow all on estimate_tests" ON public.estimate_tests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on home_visits" ON public.home_visits;
CREATE POLICY "Allow all on home_visits" ON public.home_visits FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on phlebotomists" ON public.phlebotomists;
CREATE POLICY "Allow all on phlebotomists" ON public.phlebotomists FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on message_templates" ON public.message_templates;
CREATE POLICY "Allow all on message_templates" ON public.message_templates FOR ALL USING (true) WITH CHECK (true);
