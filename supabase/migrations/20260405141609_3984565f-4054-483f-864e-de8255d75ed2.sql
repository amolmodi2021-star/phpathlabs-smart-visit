
-- Create lims_test_orders table
CREATE TABLE public.lims_test_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sample_id TEXT NOT NULL,
  patient_name TEXT,
  tests JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lims_test_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lims_test_orders" ON public.lims_test_orders
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_lims_test_orders_updated_at
  BEFORE UPDATE ON public.lims_test_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create lims_interface_logs table
CREATE TABLE public.lims_interface_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sample_id TEXT,
  direction TEXT NOT NULL DEFAULT 'incoming',
  event_type TEXT NOT NULL,
  request_body JSONB,
  response_body JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lims_interface_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lims_interface_logs" ON public.lims_interface_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Create lims_test_results table
CREATE TABLE public.lims_test_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.lims_test_orders(id) ON DELETE CASCADE,
  sample_id TEXT NOT NULL,
  test_code TEXT,
  test_name TEXT,
  result_value TEXT,
  unit TEXT,
  reference_range TEXT,
  flag TEXT,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lims_test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lims_test_results" ON public.lims_test_results
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_test_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_test_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_interface_logs;
