-- Accounts Purchase / PO / Settings
-- Cloudinary purpose for bill media
COMMENT ON COLUMN public.cloudinary_accounts.purpose IS
  'whatsapp | outsourced_pdf | bills — one active account per purpose';

-- Companies (with TDS %)
CREATE TABLE IF NOT EXISTS public.accounts_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  tds_percent numeric(6,3) NOT NULL DEFAULT 0 CHECK (tds_percent >= 0 AND tds_percent <= 100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Banks
CREATE TABLE IF NOT EXISTS public.accounts_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Payment modes (Cash / Bank; extensible)
CREATE TABLE IF NOT EXISTS public.accounts_payment_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  requires_bank boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.accounts_payment_modes (name, requires_bank, sort_order)
VALUES ('Cash', false, 10), ('Bank', true, 20)
ON CONFLICT (name) DO NOTHING;

-- Vendors
CREATE TABLE IF NOT EXISTS public.accounts_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Purchase orders
CREATE TABLE IF NOT EXISTS public.accounts_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.accounts_companies(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.accounts_vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL DEFAULT '',
  po_date date NOT NULL DEFAULT (CURRENT_DATE),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partial', 'closed', 'cancelled')),
  notes text,
  brand_primary text DEFAULT '#0f766e',
  brand_accent text DEFAULT '#134e4a',
  logo_url text,
  email_to text,
  email_sent_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounts_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.accounts_purchase_orders(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  qty_ordered numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_billed numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_billed >= 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  gst_percent numeric(6,3) NOT NULL DEFAULT 0 CHECK (gst_percent >= 0 AND gst_percent <= 100),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_item_qty_received_le_ordered CHECK (qty_received <= qty_ordered + 0.0001),
  CONSTRAINT po_item_qty_billed_le_received CHECK (qty_billed <= qty_received + 0.0001)
);

CREATE INDEX IF NOT EXISTS idx_accounts_po_items_po ON public.accounts_po_items(po_id);

-- Purchase invoices
CREATE TABLE IF NOT EXISTS public.accounts_purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.accounts_companies(id),
  vendor_id uuid REFERENCES public.accounts_vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  invoice_amount numeric(14,2) NOT NULL CHECK (invoice_amount >= 0),
  tds_percent numeric(6,3) NOT NULL DEFAULT 0,
  tds_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_payable numeric(14,2) NOT NULL DEFAULT 0,
  comment text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid')),
  po_id uuid REFERENCES public.accounts_purchase_orders(id) ON DELETE SET NULL,
  payment_mode_id uuid REFERENCES public.accounts_payment_modes(id),
  payment_date date,
  bank_id uuid REFERENCES public.accounts_banks(id),
  paid_at timestamptz,
  paid_by text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_inv_company_number
  ON public.accounts_purchase_invoices(company_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_accounts_inv_date ON public.accounts_purchase_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_inv_status ON public.accounts_purchase_invoices(status);
CREATE INDEX IF NOT EXISTS idx_accounts_inv_company ON public.accounts_purchase_invoices(company_id);

CREATE TABLE IF NOT EXISTS public.accounts_purchase_invoice_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.accounts_purchase_invoices(id) ON DELETE CASCADE,
  cloudinary_url text NOT NULL,
  public_id text,
  resource_type text,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_inv_media ON public.accounts_purchase_invoice_media(invoice_id);

-- Invoice lines billed against PO items (pay only for received goods)
CREATE TABLE IF NOT EXISTS public.accounts_invoice_po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.accounts_purchase_invoices(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES public.accounts_po_items(id) ON DELETE RESTRICT,
  qty_billed numeric(14,3) NOT NULL CHECK (qty_billed > 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  gst_percent numeric(6,3) NOT NULL DEFAULT 0,
  line_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_inv_po_lines ON public.accounts_invoice_po_lines(invoice_id);

-- Email + PO branding settings (singleton row)
CREATE TABLE IF NOT EXISTS public.accounts_module_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_from text,
  email_from_name text DEFAULT 'PH PathLabs Accounts',
  email_reply_to text,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_user text,
  smtp_pass text,
  resend_api_key text,
  po_logo_url text,
  po_brand_primary text DEFAULT '#0f766e',
  po_brand_accent text DEFAULT '#134e4a',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.accounts_module_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- RLS (staff UI uses anon key like other LIMS tables)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts_companies','accounts_banks','accounts_payment_modes','accounts_vendors',
    'accounts_purchase_orders','accounts_po_items','accounts_purchase_invoices',
    'accounts_purchase_invoice_media','accounts_invoice_po_lines','accounts_module_settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t||'_all', t
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated, service_role',
      t
    );
  END LOOP;
END $$;