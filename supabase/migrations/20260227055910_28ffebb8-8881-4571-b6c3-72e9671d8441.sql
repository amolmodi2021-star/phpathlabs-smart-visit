
-- Table for storing abnormal test history uploaded via Excel
CREATE TABLE public.abnormal_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mobile_number TEXT NOT NULL,
  message TEXT NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_context TEXT, -- 'estimate', 'home_visit', 'manual'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.abnormal_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on abnormal_history"
ON public.abnormal_history
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for fast mobile number lookups
CREATE INDEX idx_abnormal_history_mobile ON public.abnormal_history (mobile_number);

-- Trigger for updated_at
CREATE TRIGGER update_abnormal_history_updated_at
BEFORE UPDATE ON public.abnormal_history
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
