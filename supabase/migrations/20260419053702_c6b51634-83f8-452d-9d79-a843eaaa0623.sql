
CREATE TABLE public.drip_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued',
  campaign_label text,
  total_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  current_index int NOT NULL DEFAULT 0,
  started_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  current_phase text,
  contact_queue jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancel_requested boolean NOT NULL DEFAULT false
);

ALTER TABLE public.drip_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on drip_runs" ON public.drip_runs FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_drip_runs_updated_at
BEFORE UPDATE ON public.drip_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_drip_runs_status ON public.drip_runs(status);
CREATE INDEX idx_drip_runs_created_at ON public.drip_runs(created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.drip_runs;
ALTER TABLE public.drip_runs REPLICA IDENTITY FULL;
