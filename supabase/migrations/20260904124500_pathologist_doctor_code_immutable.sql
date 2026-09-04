-- Auto-allot unique doctor_code on insert; never allow changing it afterward.

CREATE OR REPLACE FUNCTION public.lims_pathologist_doctor_code_bi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int := 0;
  v_next int;
  v_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(BTRIM(COALESCE(NEW.doctor_code, '')), '') IS NULL THEN
      SELECT COALESCE(MAX(
        CASE
          WHEN upper(BTRIM(doctor_code)) ~ '^DR[0-9]+$'
            THEN substring(upper(BTRIM(doctor_code)) from 3)::int
          ELSE 0
        END
      ), 0)
        INTO v_max
      FROM public.pathologist_signatures;

      v_next := v_max + 1;
      v_code := 'DR' || lpad(v_next::text, 3, '0');
      WHILE EXISTS (
        SELECT 1 FROM public.pathologist_signatures
        WHERE upper(BTRIM(doctor_code)) = upper(v_code)
      ) LOOP
        v_next := v_next + 1;
        v_code := 'DR' || lpad(v_next::text, 3, '0');
      END LOOP;
      NEW.doctor_code := v_code;
    ELSE
      NEW.doctor_code := upper(BTRIM(NEW.doctor_code));
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- doctor_code is immutable once assigned
    NEW.doctor_code := OLD.doctor_code;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pathologist_doctor_code_bi ON public.pathologist_signatures;
CREATE TRIGGER trg_pathologist_doctor_code_bi
  BEFORE INSERT OR UPDATE ON public.pathologist_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.lims_pathologist_doctor_code_bi();