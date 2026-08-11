-- Enable Business Dashboard tab for roles that already have LIMS or Estimate Dashboard.
DO $$
DECLARE
  r RECORD;
  tabs jsonb;
BEGIN
  FOR r IN SELECT id, permissions FROM public.app_roles LOOP
    tabs := COALESCE(r.permissions->'tabs', '{}'::jsonb);
    IF (tabs ? '/lims') OR (tabs ? '/dashboard') OR (tabs ? '/') THEN
      IF jsonb_typeof(tabs->'/lims') = 'object' OR jsonb_typeof(tabs->'/dashboard') = 'object' THEN
        tabs := jsonb_set(tabs, '{/business-dashboard}', '{"enabled": true}'::jsonb, true);
      ELSE
        tabs := jsonb_set(tabs, '{/business-dashboard}', 'true'::jsonb, true);
      END IF;
      UPDATE public.app_roles
      SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{tabs}', tabs, true)
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
