ALTER TABLE public.accounts_po_catalog_items
  ADD COLUMN IF NOT EXISTS alias_name text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_accounts_po_catalog_items_alias
  ON public.accounts_po_catalog_items (lower(alias_name));