CREATE INDEX IF NOT EXISTS idx_patient_results_registration ON public.patient_results (registration_id);
CREATE INDEX IF NOT EXISTS idx_patient_results_reg_status ON public.patient_results (registration_id, status);

CREATE INDEX IF NOT EXISTS idx_sample_tubes_registration ON public.sample_tubes (registration_id);
CREATE INDEX IF NOT EXISTS idx_sample_tubes_status_created ON public.sample_tubes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sample_tubes_sample_uid ON public.sample_tubes (sample_uid);

CREATE INDEX IF NOT EXISTS idx_webhook_messages_sender_time ON public.webhook_messages (sender_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_messages_created_at ON public.webhook_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lims_test_results_sample ON public.lims_test_results (sample_id);
CREATE INDEX IF NOT EXISTS idx_lims_unmapped_results_sample ON public.lims_unmapped_results (sample_id);
CREATE INDEX IF NOT EXISTS idx_lims_unmapped_results_resolved ON public.lims_unmapped_results (is_resolved);

CREATE INDEX IF NOT EXISTS idx_loyalty_cards_job ON public.loyalty_cards (job_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_created ON public.loyalty_cards (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_login_history_user_time ON public.app_user_login_history (user_id, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_send_log_mobile_sent ON public.message_send_log (mobile_number, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_send_log_primary_key ON public.message_send_log (primary_key);

CREATE INDEX IF NOT EXISTS idx_outsourced_test_snips_test ON public.outsourced_test_snips (test_id);
