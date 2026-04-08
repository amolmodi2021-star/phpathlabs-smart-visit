
-- Table to track outsourced test result snips
CREATE TABLE public.outsourced_test_snips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL,
  test_id UUID NOT NULL,
  snip_image_url TEXT,
  result_mode TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(registration_id, test_id)
);

ALTER TABLE public.outsourced_test_snips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on outsourced_test_snips"
ON public.outsourced_test_snips
FOR ALL
USING (true)
WITH CHECK (true);

-- Storage bucket for snip images
INSERT INTO storage.buckets (id, name, public) VALUES ('outsourced-snips', 'outsourced-snips', true);

CREATE POLICY "Allow public read on outsourced-snips"
ON storage.objects FOR SELECT
USING (bucket_id = 'outsourced-snips');

CREATE POLICY "Allow public upload on outsourced-snips"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'outsourced-snips');

CREATE POLICY "Allow public update on outsourced-snips"
ON storage.objects FOR UPDATE
USING (bucket_id = 'outsourced-snips');

CREATE POLICY "Allow public delete on outsourced-snips"
ON storage.objects FOR DELETE
USING (bucket_id = 'outsourced-snips');
