ALTER TABLE public.combo_profiles
  ADD CONSTRAINT combo_profiles_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.billing_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.combo_tests
  ADD CONSTRAINT combo_tests_test_id_fkey
  FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;