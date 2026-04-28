-- Drop dormant CRM, drip, marketing campaign log, abnormal history, and unused test_result_history tables.
-- These were disabled previously; this removes them entirely to eliminate ongoing storage cost.
-- KEEP: app_user_login_history, lims_interface_logs (active LIMS audit), pathologist_signatures,
--       abnormal_card_templates (designer), marketing_templates (active sender).

DROP TABLE IF EXISTS public.crm_abnormal_tests CASCADE;
DROP TABLE IF EXISTS public.crm_blacklist CASCADE;
DROP TABLE IF EXISTS public.crm_contacts CASCADE;
DROP TABLE IF EXISTS public.crm_import_staging CASCADE;
DROP TABLE IF EXISTS public.crm_sequence_rules CASCADE;
DROP TABLE IF EXISTS public.drip_campaign_filters CASCADE;
DROP TABLE IF EXISTS public.abnormal_history CASCADE;
DROP TABLE IF EXISTS public.marketing_campaigns CASCADE;
DROP TABLE IF EXISTS public.test_result_history CASCADE;