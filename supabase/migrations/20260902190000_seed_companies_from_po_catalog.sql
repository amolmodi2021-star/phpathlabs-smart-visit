-- One-time: create companies from distinct PO catalog company names (details filled manually later).
INSERT INTO public.accounts_companies (name)
SELECT DISTINCT btrim(company_name)
FROM public.accounts_po_catalog_items
WHERE nullif(btrim(company_name), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;