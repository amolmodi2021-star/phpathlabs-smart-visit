
CREATE TABLE public.message_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number text NOT NULL,
  patient_name text,
  message_type text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on message_send_log" ON public.message_send_log FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_message_send_log_sent_at ON public.message_send_log(sent_at DESC);
CREATE INDEX idx_message_send_log_mobile ON public.message_send_log(mobile_number);
