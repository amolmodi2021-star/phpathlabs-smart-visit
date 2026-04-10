-- Enable pg_trgm extension for text search indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- patient_registrations indexes
CREATE INDEX IF NOT EXISTS idx_pr_created_at ON patient_registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_status ON patient_registrations (status);
CREATE INDEX IF NOT EXISTS idx_pr_bill_cancelled ON patient_registrations (bill_cancelled);
CREATE INDEX IF NOT EXISTS idx_pr_mobile_number ON patient_registrations (mobile_number);
CREATE INDEX IF NOT EXISTS idx_pr_umr_number ON patient_registrations (umr_number);
CREATE INDEX IF NOT EXISTS idx_pr_invoice_number ON patient_registrations (invoice_number);
CREATE INDEX IF NOT EXISTS idx_pr_patient_name_trgm ON patient_registrations USING gin (patient_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pr_cancelled_created ON patient_registrations (bill_cancelled, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_status_created ON patient_registrations (status, created_at DESC);

-- patient_results composite index
CREATE INDEX IF NOT EXISTS idx_presults_reg_status ON patient_results (registration_id, status);

-- outsourced_test_snips index
CREATE INDEX IF NOT EXISTS idx_ots_registration ON outsourced_test_snips (registration_id);

-- patient_master indexes
CREATE INDEX IF NOT EXISTS idx_pm_mobile ON patient_master (mobile_number);
CREATE INDEX IF NOT EXISTS idx_pm_umr ON patient_master (umr_id);