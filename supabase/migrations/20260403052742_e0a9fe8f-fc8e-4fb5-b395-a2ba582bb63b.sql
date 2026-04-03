CREATE TABLE public.webhook_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_number TEXT,
  sender_name TEXT,
  message TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on webhook_messages"
  ON public.webhook_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);