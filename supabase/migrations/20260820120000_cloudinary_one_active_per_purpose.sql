-- Allow one active Cloudinary account per purpose (whatsapp + outsourced_pdf).
-- Old index allowed only a single active row globally.
DROP INDEX IF EXISTS public.cloudinary_accounts_only_one_active;

DROP INDEX IF EXISTS public.cloudinary_accounts_one_active_per_purpose;
CREATE UNIQUE INDEX cloudinary_accounts_one_active_per_purpose
  ON public.cloudinary_accounts (purpose)
  WHERE is_active = true;