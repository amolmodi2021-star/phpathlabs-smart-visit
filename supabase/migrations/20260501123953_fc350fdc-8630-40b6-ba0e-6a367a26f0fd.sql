-- 1. Dedupe patient_results by keeping the newest row per (registration_id, test_id, parameter_id)
DELETE FROM public.patient_results pr
USING (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY registration_id, test_id, parameter_id
             ORDER BY updated_at DESC, created_at DESC
           ) AS rn
    FROM public.patient_results
  ) ranked
  WHERE rn > 1
) dups
WHERE pr.id = dups.id;

-- 2. Add unique index so duplicates can never accumulate again
CREATE UNIQUE INDEX IF NOT EXISTS patient_results_reg_test_param_uniq
  ON public.patient_results (registration_id, test_id, parameter_id);

-- 3. Self-heal the stuck registration 2605010004 (MONIKA GUPTA) — flip TSH result to verified
UPDATE public.patient_results
SET status = 'verified',
    verified_at = now(),
    verified_by = 'system-recovery',
    updated_at = now()
WHERE registration_id = '95c87cdd-412c-4e19-9a94-4c1b50894f1b'
  AND status = 'entered';

-- 4. Recompute parent registration status for the self-healed reg
UPDATE public.patient_registrations
SET status = 'verified', updated_at = now()
WHERE id = '95c87cdd-412c-4e19-9a94-4c1b50894f1b';