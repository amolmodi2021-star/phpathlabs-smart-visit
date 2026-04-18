
-- home_visits
CREATE INDEX IF NOT EXISTS idx_home_visits_status_date
  ON home_visits (status, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_home_visits_estimate_id
  ON home_visits (estimate_id);
CREATE INDEX IF NOT EXISTS idx_home_visits_phlebotomist
  ON home_visits (phlebotomist_id, visit_date);

-- estimates
CREATE INDEX IF NOT EXISTS idx_estimates_created_at
  ON estimates (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_whatsapp_number
  ON estimates (whatsapp_number);

-- estimate_tests
CREATE INDEX IF NOT EXISTS idx_estimate_tests_estimate_id
  ON estimate_tests (estimate_id);

-- abnormal_history
CREATE INDEX IF NOT EXISTS idx_abnormal_history_created_at
  ON abnormal_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abnormal_history_sent
  ON abnormal_history (sent, created_at DESC);

-- drip_campaign_log
CREATE INDEX IF NOT EXISTS idx_drip_campaign_log_created_at
  ON drip_campaign_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drip_campaign_log_filter
  ON drip_campaign_log (filter_id, created_at DESC);

-- message_send_log
CREATE INDEX IF NOT EXISTS idx_message_send_log_type_sent
  ON message_send_log (message_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_send_log_sent_at
  ON message_send_log (sent_at DESC);

-- approved_reports
CREATE INDEX IF NOT EXISTS idx_approved_reports_approval_date
  ON approved_reports (approval_date DESC);
CREATE INDEX IF NOT EXISTS idx_approved_reports_patient_name_trgm
  ON approved_reports USING gin (patient_name gin_trgm_ops);

-- patient_registrations
CREATE INDEX IF NOT EXISTS idx_pr_home_visit_status
  ON patient_registrations (home_visit_id, status);

-- payment_transactions
CREATE INDEX IF NOT EXISTS idx_pt_created_at
  ON payment_transactions (created_at DESC);

-- crm_abnormal_tests
CREATE INDEX IF NOT EXISTS idx_crm_abnormal_tests_contact_name
  ON crm_abnormal_tests (contact_primary_key, test_name);
