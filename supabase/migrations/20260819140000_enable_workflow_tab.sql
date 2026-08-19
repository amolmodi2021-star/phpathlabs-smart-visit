-- Enable Workflow LIMS section for roles that already have Results.
DO $$
DECLARE
  r RECORD;
  tabs jsonb;
  lims jsonb;
  sections jsonb;
  new_sections jsonb;
  i int;
  found_results boolean;
  found_workflow boolean;
  item text;
BEGIN
  FOR r IN SELECT id, permissions FROM public.app_roles LOOP
    tabs := COALESCE(r.permissions->'tabs', '{}'::jsonb);
    lims := tabs->'/lims';
    IF lims IS NULL OR jsonb_typeof(lims) <> 'object' THEN
      CONTINUE;
    END IF;
    sections := lims->'sections';
    IF sections IS NULL OR jsonb_typeof(sections) <> 'array' THEN
      CONTINUE;
    END IF;

    found_results := false;
    found_workflow := false;
    FOR i IN 0 .. jsonb_array_length(sections) - 1 LOOP
      item := sections->>i;
      IF item = 'results' THEN
        found_results := true;
      END IF;
      IF item = 'workflow' THEN
        found_workflow := true;
      END IF;
    END LOOP;

    IF found_results AND NOT found_workflow THEN
      new_sections := '[]'::jsonb;
      FOR i IN 0 .. jsonb_array_length(sections) - 1 LOOP
        item := sections->>i;
        new_sections := new_sections || to_jsonb(item);
        IF item = 'sample_acceptance' THEN
          new_sections := new_sections || '"workflow"'::jsonb;
        END IF;
      END LOOP;
      -- If sample_acceptance was missing, append before results or at end
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(new_sections) s(v)
        WHERE s.v = 'workflow'
      ) THEN
        new_sections := '[]'::jsonb;
        FOR i IN 0 .. jsonb_array_length(sections) - 1 LOOP
          item := sections->>i;
          IF item = 'results' THEN
            new_sections := new_sections || '"workflow"'::jsonb;
          END IF;
          new_sections := new_sections || to_jsonb(item);
        END LOOP;
      END IF;

      lims := jsonb_set(lims, '{sections}', new_sections, true);
      tabs := jsonb_set(tabs, '{/lims}', lims, true);
      UPDATE public.app_roles
      SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{tabs}', tabs, true)
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
