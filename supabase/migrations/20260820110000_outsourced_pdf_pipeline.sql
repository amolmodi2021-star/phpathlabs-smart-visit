-- Outsourced lab PDF pipeline (replaces image snips) + Cloudinary purpose split.

ALTER TABLE public.cloudinary_accounts
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'whatsapp';

COMMENT ON COLUMN public.cloudinary_accounts.purpose IS
  'whatsapp = WA media uploads; outsourced_pdf = lab PDF upload/compose for LIMS outsourced results.';

-- One active account per purpose
DROP INDEX IF EXISTS public.cloudinary_accounts_one_active_per_purpose;
CREATE UNIQUE INDEX cloudinary_accounts_one_active_per_purpose
  ON public.cloudinary_accounts (purpose)
  WHERE is_active = true;

ALTER TABLE public.outsourced_test_snips
  ADD COLUMN IF NOT EXISTS source_pdf_url text,
  ADD COLUMN IF NOT EXISTS source_pdf_public_id text,
  ADD COLUMN IF NOT EXISTS pdf_crop_regions jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS composed_pdf_url text,
  ADD COLUMN IF NOT EXISTS composed_pdf_public_id text;

COMMENT ON COLUMN public.outsourced_test_snips.source_pdf_url IS
  'Cloudinary URL of the lab-supplied PDF.';
COMMENT ON COLUMN public.outsourced_test_snips.pdf_crop_regions IS
  'JSON array of {pageIndex,x,y,w,h} normalized 0-1 crop boxes per source page.';
COMMENT ON COLUMN public.outsourced_test_snips.composed_pdf_url IS
  'Final letterhead-composed PDF (high-res crops) shown in pipeline / patient report.';