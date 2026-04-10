ALTER TABLE patient_registrations 
ADD COLUMN collected_samples jsonb NOT NULL DEFAULT '[]'::jsonb;