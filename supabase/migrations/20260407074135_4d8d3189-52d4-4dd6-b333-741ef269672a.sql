
CREATE OR REPLACE FUNCTION public.cleanup_blacklisted_contacts()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH deleted AS (
    DELETE FROM crm_contacts
    WHERE mobile_number IN (
      SELECT mobile_number FROM crm_blacklist
    )
    RETURNING 1
  )
  SELECT COUNT(*)::bigint FROM deleted;
$$;
