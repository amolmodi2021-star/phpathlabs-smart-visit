
CREATE TABLE public.drip_campaign_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  message_type text NOT NULL DEFAULT 'abc_card',
  priority integer NOT NULL DEFAULT 1,
  location_filter text NOT NULL DEFAULT 'ALL',
  last_sent_type_filter text DEFAULT NULL,
  last_sent_days_ago integer NOT NULL DEFAULT 7,
  record_limit integer NOT NULL DEFAULT 100,
  template_id uuid REFERENCES public.marketing_templates(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drip_campaign_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on drip_campaign_filters"
  ON public.drip_campaign_filters FOR ALL
  USING (true) WITH CHECK (true);

CREATE TABLE public.drip_campaign_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id uuid REFERENCES public.drip_campaign_filters(id) ON DELETE SET NULL,
  filter_name text,
  message_type text,
  mobile_number text,
  patient_name text,
  contact_primary_key text,
  status text NOT NULL DEFAULT 'sent',
  skip_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drip_campaign_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on drip_campaign_log"
  ON public.drip_campaign_log FOR ALL
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_drip_campaign_filters_updated_at
  BEFORE UPDATE ON public.drip_campaign_filters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
