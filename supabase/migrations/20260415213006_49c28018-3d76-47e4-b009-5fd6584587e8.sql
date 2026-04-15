
CREATE TABLE public.lims_code_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code text NOT NULL,
  machine_id text DEFAULT '',
  mapped_param_code text DEFAULT '',
  mapped_test_code text DEFAULT '',
  parameter_name text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(machine_code, machine_id)
);
ALTER TABLE public.lims_code_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on lims_code_mapping" ON public.lims_code_mapping FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.lims_unmapped_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id text NOT NULL,
  order_id uuid REFERENCES public.lims_test_orders(id) ON DELETE CASCADE,
  machine_code text NOT NULL,
  machine_id text DEFAULT '',
  result_value text DEFAULT '',
  unit text DEFAULT '',
  reference_range text DEFAULT '',
  flag text DEFAULT 'Normal',
  received_at timestamptz DEFAULT now(),
  is_resolved boolean DEFAULT false
);
ALTER TABLE public.lims_unmapped_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on lims_unmapped_results" ON public.lims_unmapped_results FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_unmapped_results;

ALTER TABLE public.lims_interface_logs ADD COLUMN IF NOT EXISTS machine_id text DEFAULT '';
