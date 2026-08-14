-- Copy pickup (and any other) live registration age onto approved_reports
-- when the snapshot was never stored. Doctor Approval used to omit age_text
-- from its registration select, so pickup PDFs printed "—" until an edit-save
-- copied the value. Do not overwrite a non-null frozen snapshot.
UPDATE public.approved_reports ar
SET age_text = pr.age_text
FROM public.patient_registrations pr
WHERE ar.registration_id = pr.id
  AND ar.age_text IS NULL
  AND NULLIF(btrim(pr.age_text), '') IS NOT NULL;
