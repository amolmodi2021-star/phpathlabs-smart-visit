ALTER TABLE home_visits DROP CONSTRAINT home_visits_status_check;
ALTER TABLE home_visits ADD CONSTRAINT home_visits_status_check CHECK (status = ANY (ARRAY['Pending'::text, 'Completed'::text, 'Cancelled'::text, 'Registered'::text]));
UPDATE home_visits SET status = 'Registered' WHERE id IN (SELECT home_visit_id FROM patient_registrations WHERE home_visit_id IS NOT NULL);