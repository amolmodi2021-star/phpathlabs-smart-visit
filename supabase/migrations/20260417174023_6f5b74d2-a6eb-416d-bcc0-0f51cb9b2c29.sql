ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS can_approve_as_doctor BOOLEAN NOT NULL DEFAULT false;