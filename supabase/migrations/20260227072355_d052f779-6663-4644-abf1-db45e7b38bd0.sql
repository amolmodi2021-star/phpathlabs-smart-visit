CREATE OR REPLACE FUNCTION get_abnormal_history_counts()
RETURNS TABLE (
  total_records BIGINT,
  unsent_records BIGINT,
  sent_records BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_records,
    COUNT(*) FILTER (WHERE sent_at IS NULL)::BIGINT AS unsent_records,
    COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::BIGINT AS sent_records
  FROM public.abnormal_history;
$$;