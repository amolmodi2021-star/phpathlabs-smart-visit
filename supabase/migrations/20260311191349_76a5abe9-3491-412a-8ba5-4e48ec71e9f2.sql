
INSERT INTO storage.buckets (id, name, public) VALUES ('letterheads', 'letterheads', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public read on letterheads" ON storage.objects FOR SELECT USING (bucket_id = 'letterheads');
CREATE POLICY "Allow upload to letterheads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'letterheads');
CREATE POLICY "Allow update letterheads" ON storage.objects FOR UPDATE USING (bucket_id = 'letterheads');
CREATE POLICY "Allow delete letterheads" ON storage.objects FOR DELETE USING (bucket_id = 'letterheads');
