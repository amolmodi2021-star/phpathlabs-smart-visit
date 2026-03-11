
ALTER TABLE public.extracted_report_data
  ADD COLUMN IF NOT EXISTS reg_no text,
  ADD COLUMN IF NOT EXISTS reg_date text,
  ADD COLUMN IF NOT EXISTS sample_collection_date text,
  ADD COLUMN IF NOT EXISTS accession_date text,
  ADD COLUMN IF NOT EXISTS authentication_date text,
  ADD COLUMN IF NOT EXISTS print_date text,
  ADD COLUMN IF NOT EXISTS location text;

ALTER TABLE public.uploaded_reports
  ADD COLUMN IF NOT EXISTS reg_no text,
  ADD COLUMN IF NOT EXISTS reg_date text;
