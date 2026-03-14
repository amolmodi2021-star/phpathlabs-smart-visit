ALTER TABLE public.report_profiles ADD COLUMN enable_test_grouping boolean DEFAULT false;

UPDATE public.report_profiles SET enable_test_grouping = true WHERE lower(profile_name) LIKE '%cbc%' OR lower(profile_name) LIKE '%complete blood count%' OR lower(profile_name) LIKE '%urine routine%';