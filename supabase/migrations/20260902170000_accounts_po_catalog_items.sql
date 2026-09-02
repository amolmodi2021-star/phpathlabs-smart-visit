-- Master catalog of reusable PO items (separate from accounts_po_items line rows).

CREATE SEQUENCE IF NOT EXISTS public.accounts_po_catalog_code_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.accounts_po_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code text NOT NULL,
  item_name text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  gst_rate numeric(6,3) NOT NULL DEFAULT 0
    CHECK (gst_rate >= 0 AND gst_rate <= 100),
  price numeric(14,2) NOT NULL DEFAULT 0
    CHECK (price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_po_catalog_items_code_unique UNIQUE (item_code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_po_catalog_items_name
  ON public.accounts_po_catalog_items (lower(item_name));
CREATE INDEX IF NOT EXISTS idx_accounts_po_catalog_items_active
  ON public.accounts_po_catalog_items (is_active);

CREATE OR REPLACE FUNCTION public.accounts_po_catalog_next_code()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'POI' || lpad(nextval('public.accounts_po_catalog_code_seq')::text, 5, '0');
$$;

CREATE OR REPLACE FUNCTION public.accounts_po_catalog_set_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.item_code IS NULL OR btrim(NEW.item_code) = '' THEN
    NEW.item_code := public.accounts_po_catalog_next_code();
  ELSE
    NEW.item_code := upper(btrim(NEW.item_code));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_po_catalog_set_code ON public.accounts_po_catalog_items;
CREATE TRIGGER trg_accounts_po_catalog_set_code
  BEFORE INSERT OR UPDATE ON public.accounts_po_catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.accounts_po_catalog_set_code();

CREATE OR REPLACE FUNCTION public.accounts_po_catalog_sync_code_seq()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_n bigint;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN item_code ~ '^POI[0-9]+$' THEN substring(item_code from 4)::bigint
      ELSE 0
    END
  ), 0)
  INTO max_n
  FROM public.accounts_po_catalog_items;

  IF max_n < 1 THEN
    PERFORM setval('public.accounts_po_catalog_code_seq', 1, false);
  ELSE
    PERFORM setval('public.accounts_po_catalog_code_seq', max_n, true);
  END IF;
END;
$$;

ALTER TABLE public.accounts_po_catalog_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_po_catalog_items_all ON public.accounts_po_catalog_items;
CREATE POLICY accounts_po_catalog_items_all
  ON public.accounts_po_catalog_items
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_po_catalog_items TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.accounts_po_catalog_code_seq TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounts_po_catalog_next_code() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounts_po_catalog_sync_code_seq() TO anon, authenticated, service_role;