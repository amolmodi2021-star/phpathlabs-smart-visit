-- Ensure PRM / TST / HLT / PRL / CMB codes stay unique forever.
-- 1) Heal existing duplicates (keep oldest row per code; reassign newer ones).
-- 2) Resync denormalized patient_results.param_code.
-- 3) Reset sequences past MAX.
-- 4) Harden BEFORE INSERT triggers (reject colliding client-supplied codes).
-- 5) UNIQUE indexes.

-- ── Helpers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_prefixed_code(p_prefix text, p_seq regclass, p_width int DEFAULT 4)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RETURN p_prefix || lpad(nextval(p_seq)::text, p_width, '0');
END;
$$;

-- ── 1a) Heal duplicate param_code ────────────────────────────────────────────

DO $$
DECLARE
  r record;
  new_code text;
  max_n int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(param_code, '[^0-9]', '', 'g'), '')::int), 0)
  INTO max_n FROM public.report_test_parameters WHERE param_code ~ '^PRM[0-9]+$';
  IF max_n < 1 THEN
    PERFORM setval('param_code_seq', 1, false);
  ELSE
    PERFORM setval('param_code_seq', max_n, true);
  END IF;

  FOR r IN
    SELECT id, param_code, parameter_name
    FROM (
      SELECT id, param_code, parameter_name, created_at,
             ROW_NUMBER() OVER (PARTITION BY param_code ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
      FROM public.report_test_parameters
      WHERE param_code IS NOT NULL AND btrim(param_code) <> ''
    ) x
    WHERE rn > 1
    ORDER BY param_code, created_at
  LOOP
    new_code := public.next_prefixed_code('PRM', 'param_code_seq'::regclass, 4);
    UPDATE public.report_test_parameters SET param_code = new_code WHERE id = r.id;
    RAISE NOTICE 'param % (%) % -> %', r.parameter_name, r.id, r.param_code, new_code;
  END LOOP;
END $$;

-- Keep patient_results.param_code in sync with master
UPDATE public.patient_results pr
SET param_code = rtp.param_code
FROM public.report_test_parameters rtp
WHERE pr.parameter_id = rtp.id
  AND rtp.param_code IS NOT NULL
  AND pr.param_code IS DISTINCT FROM rtp.param_code;

-- ── 1b) Heal duplicate test_code ─────────────────────────────────────────────

DO $$
DECLARE
  r record;
  new_code text;
  max_n int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(test_code, '[^0-9]', '', 'g'), '')::int), 0)
  INTO max_n FROM public.tests WHERE test_code ~ '^TST[0-9]+$';
  IF max_n < 1 THEN
    PERFORM setval('test_code_seq', 1, false);
  ELSE
    PERFORM setval('test_code_seq', max_n, true);
  END IF;

  FOR r IN
    SELECT id, test_code, test_name
    FROM (
      SELECT id, test_code, test_name, created_at,
             ROW_NUMBER() OVER (PARTITION BY test_code ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
      FROM public.tests
      WHERE test_code IS NOT NULL AND btrim(test_code) <> ''
    ) x
    WHERE rn > 1
    ORDER BY test_code, created_at
  LOOP
    new_code := public.next_prefixed_code('TST', 'test_code_seq'::regclass, 4);
    UPDATE public.tests SET test_code = new_code WHERE id = r.id;
    RAISE NOTICE 'test % (%) % -> %', r.test_name, r.id, r.test_code, new_code;
  END LOOP;
END $$;

-- ── 1c) Heal HLT / PRL / CMB if any (defensive) ──────────────────────────────

DO $$
DECLARE
  r record;
  new_code text;
  max_n int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(health_checkup_code, '[^0-9]', '', 'g'), '')::int), 0)
  INTO max_n FROM public.health_checkups WHERE health_checkup_code ~ '^HLT[0-9]+$';
  IF max_n < 1 THEN PERFORM setval('health_checkup_code_seq', 1, false);
  ELSE PERFORM setval('health_checkup_code_seq', max_n, true); END IF;

  FOR r IN
    SELECT id, health_checkup_code
    FROM (
      SELECT id, health_checkup_code, created_at,
             ROW_NUMBER() OVER (PARTITION BY health_checkup_code ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
      FROM public.health_checkups
      WHERE health_checkup_code IS NOT NULL AND btrim(health_checkup_code) <> ''
    ) x WHERE rn > 1
  LOOP
    new_code := public.next_prefixed_code('HLT', 'health_checkup_code_seq'::regclass, 4);
    UPDATE public.health_checkups SET health_checkup_code = new_code WHERE id = r.id;
  END LOOP;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(profile_code, '[^0-9]', '', 'g'), '')::int), 0)
  INTO max_n FROM public.billing_profiles WHERE profile_code ~ '^PRL[0-9]+$';
  IF max_n < 1 THEN PERFORM setval('billing_profile_code_seq', 1, false);
  ELSE PERFORM setval('billing_profile_code_seq', max_n, true); END IF;

  FOR r IN
    SELECT id, profile_code
    FROM (
      SELECT id, profile_code, created_at,
             ROW_NUMBER() OVER (PARTITION BY profile_code ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
      FROM public.billing_profiles
      WHERE profile_code IS NOT NULL AND btrim(profile_code) <> ''
    ) x WHERE rn > 1
  LOOP
    new_code := public.next_prefixed_code('PRL', 'billing_profile_code_seq'::regclass, 4);
    UPDATE public.billing_profiles SET profile_code = new_code WHERE id = r.id;
  END LOOP;

  IF to_regclass('public.combos') IS NOT NULL THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(combo_code, '[^0-9]', '', 'g'), '')::int), 0)
    INTO max_n FROM public.combos WHERE combo_code ~ '^CMB[0-9]+$';
    IF max_n < 1 THEN PERFORM setval('combo_code_seq', 1, false);
    ELSE PERFORM setval('combo_code_seq', max_n, true); END IF;

    FOR r IN
      SELECT id, combo_code
      FROM (
        SELECT id, combo_code, created_at,
               ROW_NUMBER() OVER (PARTITION BY combo_code ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
        FROM public.combos
        WHERE combo_code IS NOT NULL AND btrim(combo_code) <> ''
      ) x WHERE rn > 1
    LOOP
      new_code := public.next_prefixed_code('CMB', 'combo_code_seq'::regclass, 4);
      UPDATE public.combos SET combo_code = new_code WHERE id = r.id;
    END LOOP;
  END IF;
END $$;

-- ── 2) Harden auto-assign triggers (unique even if client sends a code) ──────

CREATE OR REPLACE FUNCTION public.auto_assign_param_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.param_code IS NULL OR btrim(NEW.param_code) = ''
     OR EXISTS (
       SELECT 1 FROM public.report_test_parameters p
       WHERE p.param_code = NEW.param_code
         AND p.id IS DISTINCT FROM NEW.id
     )
  THEN
    NEW.param_code := public.next_prefixed_code('PRM', 'param_code_seq'::regclass, 4);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_test_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.test_code IS NULL OR btrim(NEW.test_code) = ''
     OR EXISTS (
       SELECT 1 FROM public.tests t
       WHERE t.test_code = NEW.test_code
         AND t.id IS DISTINCT FROM NEW.id
     )
  THEN
    NEW.test_code := public.next_prefixed_code('TST', 'test_code_seq'::regclass, 4);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_health_checkup_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.health_checkup_code IS NULL OR btrim(NEW.health_checkup_code) = ''
     OR EXISTS (
       SELECT 1 FROM public.health_checkups h
       WHERE h.health_checkup_code = NEW.health_checkup_code
         AND h.id IS DISTINCT FROM NEW.id
     )
  THEN
    NEW.health_checkup_code := public.next_prefixed_code('HLT', 'health_checkup_code_seq'::regclass, 4);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_profile_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.profile_code IS NULL OR btrim(NEW.profile_code) = ''
     OR EXISTS (
       SELECT 1 FROM public.billing_profiles b
       WHERE b.profile_code = NEW.profile_code
         AND b.id IS DISTINCT FROM NEW.id
     )
  THEN
    NEW.profile_code := public.next_prefixed_code('PRL', 'billing_profile_code_seq'::regclass, 4);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.auto_assign_combo_code()') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.auto_assign_combo_code()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path TO 'public'
      AS $body$
      BEGIN
        IF NEW.combo_code IS NULL OR btrim(NEW.combo_code) = ''
           OR EXISTS (
             SELECT 1 FROM public.combos c
             WHERE c.combo_code = NEW.combo_code
               AND c.id IS DISTINCT FROM NEW.id
           )
        THEN
          NEW.combo_code := public.next_prefixed_code('CMB', 'combo_code_seq'::regclass, 4);
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- ── 3) UNIQUE indexes (after heal) ───────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS report_test_parameters_param_code_uidx
  ON public.report_test_parameters (param_code)
  WHERE param_code IS NOT NULL AND btrim(param_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS tests_test_code_uidx
  ON public.tests (test_code)
  WHERE test_code IS NOT NULL AND btrim(test_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS health_checkups_code_uidx
  ON public.health_checkups (health_checkup_code)
  WHERE health_checkup_code IS NOT NULL AND btrim(health_checkup_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS billing_profiles_code_uidx
  ON public.billing_profiles (profile_code)
  WHERE profile_code IS NOT NULL AND btrim(profile_code) <> '';

DO $$
BEGIN
  IF to_regclass('public.combos') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS combos_combo_code_uidx
        ON public.combos (combo_code)
        WHERE combo_code IS NOT NULL AND btrim(combo_code) <> '';
    $sql$;
  END IF;
END $$;
