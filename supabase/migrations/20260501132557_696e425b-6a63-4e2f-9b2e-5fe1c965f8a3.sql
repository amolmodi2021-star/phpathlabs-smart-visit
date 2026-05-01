UPDATE public.patient_registrations
SET status = 'partial_processing', updated_at = now()
WHERE id = '53d14ada-63ba-44df-a02a-972fcd932b62';