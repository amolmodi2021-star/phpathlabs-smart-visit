-- Enable realtime broadcasts for app_settings so every signed-in device is
-- notified the instant an admin bumps the global auth_epoch (Logout All Users).
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings';
  END IF;
END $$;