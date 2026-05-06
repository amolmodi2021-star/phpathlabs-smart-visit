CREATE TABLE IF NOT EXISTS public.doctors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS doctors_name_unique_upper ON public.doctors (upper(doctor_name));

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on doctors" ON public.doctors FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_doctors_updated_at
BEFORE UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed with existing distinct doctor names from registrations (excluding SELF blank)
INSERT INTO public.doctors (doctor_name)
SELECT DISTINCT upper(trim(doctor_name))
FROM public.patient_registrations
WHERE doctor_name IS NOT NULL AND trim(doctor_name) <> '' AND upper(trim(doctor_name)) <> 'SELF'
ON CONFLICT DO NOTHING;