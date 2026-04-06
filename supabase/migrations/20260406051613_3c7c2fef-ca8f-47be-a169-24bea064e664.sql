
CREATE TABLE public.drip_mobile_cycles (
  mobile_number text PRIMARY KEY,
  current_cycle integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drip_mobile_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on drip_mobile_cycles"
ON public.drip_mobile_cycles
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.drip_campaign_log ADD COLUMN cycle_number integer NOT NULL DEFAULT 1;
