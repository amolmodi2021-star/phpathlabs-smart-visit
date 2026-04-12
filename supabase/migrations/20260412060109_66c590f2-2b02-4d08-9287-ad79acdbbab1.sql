INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', true);

CREATE POLICY "Anyone can view chat attachments" ON storage.objects FOR SELECT USING (bucket_id = 'chat-attachments');
CREATE POLICY "Anyone can upload chat attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-attachments');
CREATE POLICY "Anyone can update chat attachments" ON storage.objects FOR UPDATE USING (bucket_id = 'chat-attachments');
CREATE POLICY "Anyone can delete chat attachments" ON storage.objects FOR DELETE USING (bucket_id = 'chat-attachments');