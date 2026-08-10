-- Fast bulk import for ~20k+ legacy patient Excel rows.
CREATE OR REPLACE FUNCTION public.import_legacy_patients_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (btrim(umr_id))
      btrim(umr_id) AS umr_id,
      NULLIF(btrim(patient_name), '') AS patient_name,
      NULLIF(btrim(title), '') AS title,
      NULLIF(btrim(gender), '') AS gender,
      NULLIF(btrim(mobile_number), '') AS mobile_number,
      NULLIF(btrim(address), '') AS address
    FROM jsonb_to_recordset(p_rows) AS x(
      umr_id text,
      patient_name text,
      title text,
      gender text,
      mobile_number text,
      address text
    )
    WHERE umr_id IS NOT NULL AND btrim(umr_id) <> ''
    ORDER BY btrim(umr_id)
  ),
  upserted AS (
    INSERT INTO public.patient_master (
      umr_id, patient_name, title, gender, mobile_number, address, source, legacy_imported_at
    )
    SELECT
      i.umr_id,
      COALESCE(i.patient_name, 'UNKNOWN'),
      i.title,
      i.gender,
      i.mobile_number,
      i.address,
      'legacy',
      v_now
    FROM incoming i
    ON CONFLICT (umr_id) DO UPDATE SET
      patient_name = CASE
        WHEN public.patient_master.patient_name IS NULL OR btrim(public.patient_master.patient_name) = ''
          THEN EXCLUDED.patient_name
        ELSE public.patient_master.patient_name
      END,
      title = CASE
        WHEN public.patient_master.title IS NULL OR btrim(public.patient_master.title) = ''
          THEN EXCLUDED.title
        ELSE public.patient_master.title
      END,
      gender = CASE
        WHEN public.patient_master.gender IS NULL OR btrim(public.patient_master.gender) = ''
          THEN EXCLUDED.gender
        ELSE public.patient_master.gender
      END,
      mobile_number = CASE
        WHEN public.patient_master.mobile_number IS NULL OR btrim(public.patient_master.mobile_number) = ''
          THEN EXCLUDED.mobile_number
        ELSE public.patient_master.mobile_number
      END,
      address = CASE
        WHEN public.patient_master.address IS NULL OR btrim(public.patient_master.address) = ''
          THEN EXCLUDED.address
        ELSE public.patient_master.address
      END,
      legacy_imported_at = COALESCE(public.patient_master.legacy_imported_at, EXCLUDED.legacy_imported_at)
    WHERE public.patient_master.source = 'legacy'
       OR public.patient_master.patient_name IS NULL OR btrim(public.patient_master.patient_name) = ''
       OR public.patient_master.title IS NULL OR btrim(public.patient_master.title) = ''
       OR public.patient_master.gender IS NULL OR btrim(public.patient_master.gender) = ''
       OR public.patient_master.mobile_number IS NULL OR btrim(public.patient_master.mobile_number) = ''
       OR public.patient_master.address IS NULL OR btrim(public.patient_master.address) = ''
    RETURNING (xmax = 0) AS was_insert
  )
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE was_insert), 0),
    COALESCE(COUNT(*) FILTER (WHERE NOT was_insert), 0)
  INTO v_inserted, v_updated
  FROM upserted;

  UPDATE public.umr_counter
  SET last_sequence = GREATEST(
    last_sequence,
    COALESCE((
      SELECT MAX(NULLIF(regexp_replace(umr_id, '\D', '', 'g'), '')::int)
      FROM public.patient_master
      WHERE umr_id ~ '^UMR\d+$'
    ), 0),
    COALESCE((
      SELECT MAX(NULLIF(regexp_replace(umr_number, '\D', '', 'g'), '')::int)
      FROM public.patient_registrations
      WHERE umr_number ~ '^UMR\d+$'
    ), 0)
  )
  WHERE counter_key = 'main';

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.import_legacy_patients_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_legacy_patients_batch(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.import_legacy_patients_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_legacy_patients_batch(jsonb) TO service_role;
