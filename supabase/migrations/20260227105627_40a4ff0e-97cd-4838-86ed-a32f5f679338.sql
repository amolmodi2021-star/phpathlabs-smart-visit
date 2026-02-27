
ALTER TABLE public.estimates
ADD COLUMN title text DEFAULT NULL,
ADD COLUMN gender text DEFAULT NULL,
ADD COLUMN email text DEFAULT NULL,
ADD COLUMN doctor_name text DEFAULT 'SELF',
ADD COLUMN umr_number text DEFAULT NULL;
