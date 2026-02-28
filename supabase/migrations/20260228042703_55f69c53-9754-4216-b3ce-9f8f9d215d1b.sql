
-- Add weekly off days column to phlebotomists (array of day numbers: 0=Sun, 1=Mon, ..., 6=Sat)
ALTER TABLE public.phlebotomists ADD COLUMN weekly_off_days integer[] DEFAULT '{}';

-- Create table for specific leave dates
CREATE TABLE public.phlebotomist_leaves (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phlebotomist_id uuid NOT NULL REFERENCES public.phlebotomists(id) ON DELETE CASCADE,
  leave_date date NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(phlebotomist_id, leave_date)
);

ALTER TABLE public.phlebotomist_leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on phlebotomist_leaves" ON public.phlebotomist_leaves FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.phlebotomist_leaves;
