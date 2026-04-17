CREATE TABLE public.lims_no_map_required (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code text NOT NULL,
  machine_id text DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lims_no_map_required_machine_code_key UNIQUE (machine_code)
);

ALTER TABLE public.lims_no_map_required ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lims_no_map_required"
ON public.lims_no_map_required
FOR ALL
USING (true)
WITH CHECK (true);