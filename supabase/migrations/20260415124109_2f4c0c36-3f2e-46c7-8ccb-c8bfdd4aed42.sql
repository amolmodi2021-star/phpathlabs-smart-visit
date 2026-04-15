
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-assets', 'invoice-assets', true);

CREATE POLICY "Anyone can read invoice assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can upload invoice assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can update invoice assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can delete invoice assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'invoice-assets');
