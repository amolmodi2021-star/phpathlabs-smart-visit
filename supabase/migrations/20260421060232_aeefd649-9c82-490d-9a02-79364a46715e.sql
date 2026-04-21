-- Drop legacy PDF extraction tables (no longer referenced by application code)
DROP TABLE IF EXISTS public.extracted_report_data CASCADE;
DROP TABLE IF EXISTS public.generated_reports CASCADE;
DROP TABLE IF EXISTS public.extraction_corrections CASCADE;
DROP TABLE IF EXISTS public.uploaded_reports CASCADE;