
-- Create prescriptions storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('prescriptions', 'prescriptions', true);

-- Allow anyone to upload to prescriptions bucket
CREATE POLICY "Anyone can upload prescriptions"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'prescriptions');

-- Allow anyone to read prescriptions
CREATE POLICY "Anyone can read prescriptions"
ON storage.objects FOR SELECT
USING (bucket_id = 'prescriptions');

-- Allow anyone to delete prescriptions (for cleanup)
CREATE POLICY "Anyone can delete prescriptions"
ON storage.objects FOR DELETE
USING (bucket_id = 'prescriptions');
