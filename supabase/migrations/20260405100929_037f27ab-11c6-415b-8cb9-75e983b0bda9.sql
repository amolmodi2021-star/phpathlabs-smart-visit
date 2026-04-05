
-- Delete duplicates, keeping only the latest row per (contact_primary_key, test_name, test_date)
DELETE FROM crm_abnormal_tests
WHERE id NOT IN (
  SELECT DISTINCT ON (contact_primary_key, test_name, COALESCE(test_date, ''))
    id
  FROM crm_abnormal_tests
  ORDER BY contact_primary_key, test_name, COALESCE(test_date, ''), created_at DESC
);

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX idx_crm_abnormal_tests_dedup 
ON crm_abnormal_tests (contact_primary_key, test_name, COALESCE(test_date, ''));
