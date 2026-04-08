ALTER TABLE public.outsourced_test_snips
ADD COLUMN IF NOT EXISTS snip_image_urls jsonb DEFAULT '[]'::jsonb;